# Jarvischan floating icon.
#
# A small always-on-top round button that agent.js starts alongside itself.
# Talks to agent.js over plain stdin/stdout lines, so it needs no port or
# token of its own:
#   stdout  click   left-click (not a drag)      -> agent tells the page to listen
#           launch  "open" picked, no window found -> agent starts the Jarvischan app
#           hide    "hide icon" picked            -> this process then exits
#   stdin   offline | idle | listening | thinking | speaking  -> ring colour
#           (stdin closing means the agent quit, so the icon quits too)
#
# Kept ASCII-only on purpose: Windows PowerShell 5.1 reads a BOM-less .ps1
# in the ANSI code page, so the Korean menu labels are \u escapes below.
param([string]$IconPath, [string]$PosFile)

Add-Type -ReferencedAssemblies System.Windows.Forms, System.Drawing -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

public class JarvischanFloat : Form {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  delegate bool EnumProc(IntPtr h, IntPtr p);

  const int BASE_SIZE = 56;
  readonly Image img;
  readonly string posFile;
  readonly ConcurrentQueue<string> inbox = new ConcurrentQueue<string>();
  string state = "offline";
  float phase;
  bool dragging, moved;
  Point downAt, formAt;

  public static void Run(string iconPath, string posFile) {
    SetProcessDPIAware();
    Application.EnableVisualStyles();
    Application.Run(new JarvischanFloat(iconPath, posFile));
  }

  JarvischanFloat(string iconPath, string posFile) {
    this.posFile = posFile;
    img = Image.FromFile(iconPath);
    FormBorderStyle = FormBorderStyle.None;
    ShowInTaskbar = false;
    TopMost = true;
    StartPosition = FormStartPosition.Manual;
    BackColor = Color.Black;
    Text = "Jarvischan floating icon";
    SetStyle(ControlStyles.OptimizedDoubleBuffer | ControlStyles.AllPaintingInWmPaint | ControlStyles.UserPaint, true);

    float scale;
    using (var g = CreateGraphics()) scale = g.DpiX / 96f;
    int size = (int)Math.Round(BASE_SIZE * scale);
    Size = new Size(size, size);
    var circle = new GraphicsPath();
    circle.AddEllipse(0, 0, size, size);
    Region = new Region(circle);
    Location = LoadPosition(size);
    ApplyState();

    var menu = new ContextMenuStrip();
    menu.Items.Add("Jarvischan \uCC3D \uC5F4\uAE30", null, (s, e) => ShowJarvischan());
    menu.Items.Add("\uC544\uC774\uCF58 \uC228\uAE30\uAE30", null, (s, e) => { Emit("hide"); Close(); });
    ContextMenuStrip = menu;

    // stdin is read on a background thread and handed to the UI thread
    // through a queue, drained by the timer below.
    var reader = new Thread(() => {
      string line;
      try { while ((line = Console.In.ReadLine()) != null) inbox.Enqueue(line.Trim()); } catch {}
      inbox.Enqueue("__eof");
    });
    reader.IsBackground = true;
    reader.Start();

    var timer = new System.Windows.Forms.Timer();
    timer.Interval = 50;
    timer.Tick += (s, e) => {
      string msg;
      while (inbox.TryDequeue(out msg)) {
        if (msg == "__eof") { Close(); return; }
        if (msg == "offline" || msg == "idle" || msg == "listening" || msg == "thinking" || msg == "speaking") {
          state = msg; ApplyState();
        }
      }
      if (state == "listening" || state == "thinking" || state == "speaking") { phase += 0.2f; Invalidate(); }
    };
    timer.Start();
  }

  // Never take focus: clicking the icon must leave the app the user is
  // in active. WS_EX_TOOLWINDOW also keeps it out of Alt+Tab and away from
  // the agent's close_window command.
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get { var cp = base.CreateParams; cp.ExStyle |= 0x80 | 0x08000000; return cp; }
  }

  void ApplyState() {
    // Dimmed while no Jarvischan page is connected to the agent.
    Opacity = state == "offline" ? 0.45 : 0.95;
    Invalidate();
  }

  protected override void OnPaint(PaintEventArgs e) {
    var g = e.Graphics;
    g.SmoothingMode = SmoothingMode.AntiAlias;
    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
    g.DrawImage(img, 0, 0, Width, Height);
    Color ring;
    if (state == "listening") ring = Color.FromArgb(255, 80, 90);
    else if (state == "thinking") ring = Color.FromArgb(255, 181, 71);
    else if (state == "speaking") ring = Color.FromArgb(120, 230, 255);
    else return;
    int alpha = (int)(150 + 105 * Math.Sin(phase));
    float w = Math.Max(3f, Width / 14f);
    using (var pen = new Pen(Color.FromArgb(alpha, ring), w))
      g.DrawEllipse(pen, w / 2, w / 2, Width - w, Height - w);
  }

  protected override void OnMouseDown(MouseEventArgs e) {
    if (e.Button != MouseButtons.Left) return;
    dragging = true; moved = false;
    downAt = Cursor.Position; formAt = Location;
  }
  protected override void OnMouseMove(MouseEventArgs e) {
    if (!dragging) return;
    var p = Cursor.Position;
    int dx = p.X - downAt.X, dy = p.Y - downAt.Y;
    if (Math.Abs(dx) > 4 || Math.Abs(dy) > 4) moved = true;
    if (moved) Location = new Point(formAt.X + dx, formAt.Y + dy);
  }
  protected override void OnMouseUp(MouseEventArgs e) {
    if (e.Button != MouseButtons.Left || !dragging) return;
    dragging = false;
    if (moved) SavePosition(); else Emit("click");
  }

  static void Emit(string ev) { Console.Out.WriteLine(ev); Console.Out.Flush(); }

  // Brings an open Jarvischan window (installed app or browser tab) to the
  // front. Allowed to take the foreground because this process just got
  // the user's click. Skips this icon and the agent's console window.
  void ShowJarvischan() {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, p) => {
      if (h == Handle || !IsWindowVisible(h)) return true;
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      string title = t.ToString();
      if (title.StartsWith("Jarvischan", StringComparison.OrdinalIgnoreCase)
          && title.IndexOf("agent", StringComparison.OrdinalIgnoreCase) < 0
          && title.IndexOf("floating icon", StringComparison.OrdinalIgnoreCase) < 0) {
        found = h; return false;
      }
      return true;
    }, IntPtr.Zero);
    if (found == IntPtr.Zero) { Emit("launch"); return; }
    if (IsIconic(found)) ShowWindow(found, 9);   // SW_RESTORE
    SetForegroundWindow(found);
  }

  Point LoadPosition(int size) {
    try {
      var parts = File.ReadAllText(posFile).Split(',');
      var p = new Point(int.Parse(parts[0]), int.Parse(parts[1]));
      // Only reuse it if it's still on a connected screen (a monitor may
      // have been unplugged since).
      foreach (var s in Screen.AllScreens)
        if (s.WorkingArea.Contains(new Rectangle(p, new Size(size, size)))) return p;
    } catch {}
    var wa = Screen.PrimaryScreen.WorkingArea;
    int margin = size / 2;
    return new Point(wa.Right - size - margin, wa.Bottom - size - margin);
  }
  void SavePosition() {
    try { File.WriteAllText(posFile, Location.X + "," + Location.Y); } catch {}
  }
}
'@

[JarvischanFloat]::Run($IconPath, $PosFile)
