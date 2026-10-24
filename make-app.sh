#!/bin/bash
# Builds a double-clickable Torlink.app that launches the GUI without any
# terminal or commands. Re-run this if you move the project folder.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")" && pwd)"
APP="$PROJECT/Torlink.app"
ICON_PNG="$(mktemp -d)/torlink-icon.png"

echo "Building $APP …"

# ---- 1. Compile the AppleScript launcher ----
cat > /tmp/torlink-launcher.applescript <<EOF
on run argv
	do shell script "export PATH=/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin; nohup bash " & quoted form of "$PROJECT/launch.sh" & " > /dev/null 2>&1 &"
end run
EOF

rm -rf "$APP"
osacompile -o "$APP" /tmp/torlink-launcher.applescript

# ---- 2. Custom app metadata ----
PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Torlink" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleName string Torlink" "$PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string Torlink" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string dev.torlink.gui" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleVersion string 1.0" "$PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 1.0" "$PLIST" 2>/dev/null || true

# ---- 3. App icon (swirl on a rounded gradient) ----
if command -v swift >/dev/null 2>&1; then
  cat > /tmp/torlink-icon.swift <<'EOF'
import AppKit
let size = NSSize(width: 1024, height: 1024)
let image = NSImage(size: size)
image.lockFocus()
let rect = NSRect(origin: .zero, size: size)
let grad = NSGradient(colors: [
  NSColor(calibratedRed: 0.30, green: 0.44, blue: 0.90, alpha: 1),
  NSColor(calibratedRed: 0.36, green: 0.18, blue: 0.88, alpha: 1),
])!
grad.draw(in: NSBezierPath(roundedRect: rect, xRadius: 180, yRadius: 180), angle: -60)
let font = NSFont.systemFont(ofSize: 640)
let attrs: [NSAttributedString.Key: Any] = [.font: font]
let str = NSAttributedString(string: "🌀", attributes: attrs)
let ts = str.size()
str.draw(at: NSPoint(x: (size.width - ts.width) / 2, y: (size.height - ts.height) / 2))
image.unlockFocus()
let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
let png = rep.representation(using: .png, properties: [:])!
try! png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
EOF
  swift /tmp/torlink-icon.swift "$ICON_PNG" 2>/dev/null || rm -f "$ICON_PNG"
fi

if [ -f "$ICON_PNG" ]; then
  ICONSET="$(mktemp -d)/icon.iconset"
  mkdir -p "$ICONSET"
  for s in 16 32 128 256 512; do
    sips -z "$s" "$s" "$ICON_PNG" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null 2>&1
    sips -z "$((s*2))" "$((s*2))" "$ICON_PNG" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null 2>&1
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/applet.icns"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" "$PLIST" 2>/dev/null || true
  rm -rf "$ICONSET"
fi

chmod +x "$APP/Contents/MacOS/applet"

echo "Done: $APP"
echo "Double-click it, or drag it to /Applications or your Dock."
