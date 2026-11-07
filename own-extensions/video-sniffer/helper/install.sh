#!/bin/sh
# Installs the Video Sniffer helper for the current user and starts it at every login.
set -e
DIR="$HOME/.local/share/video-sniffer-helper"
mkdir -p "$DIR" "$HOME/.config/autostart"
cp "$(dirname "$0")/video-sniffer-helper.py" "$DIR/video-sniffer-helper.py"
cat > "$HOME/.config/autostart/video-sniffer-helper.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Video Sniffer helper
Exec=python3 $DIR/video-sniffer-helper.py
X-GNOME-Autostart-enabled=true
NoDisplay=true
EOF
pkill -f video-sniffer-helper.py 2>/dev/null || true
nohup python3 "$DIR/video-sniffer-helper.py" >/dev/null 2>&1 &
echo "Helper installed in $DIR and started. Config: ~/.config/video-sniffer-helper/config.json"
echo "yt-dlp is separate: https://github.com/yt-dlp/yt-dlp#installation"
