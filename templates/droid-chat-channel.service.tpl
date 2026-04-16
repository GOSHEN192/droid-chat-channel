[Unit]
Description=Droid Chat Channel (%NAME% - %PLATFORM%)
After=network.target

[Service]
Type=simple
User=%USER%
WorkingDirectory=%WORKDIR%

# ---- Platform ----
Environment="PLATFORM=%PLATFORM%"

# ---- Telegram ----
Environment="TELEGRAM_BOT_TOKEN=%TELEGRAM_BOT_TOKEN%"

# ---- Access Control ----
Environment "ALLOWED_USERS=%ALLOWED_USERS%"

# ---- Droid ----
Environment="DROID_MODEL=%DROID_MODEL%"
Environment="DROID_PATH=%DROID_PATH%"
Environment="DROID_TIMEOUT=%DROID_TIMEOUT%"
Environment="DATA_DIR=%DATA_DIR%"

# ---- API Keys (must be here, systemd does not source .bashrc) ----
Environment="MINIMAX_API_KEY=%MINIMAX_API_KEY%"
Environment="ZAI_API_KEY=%ZAI_API_KEY%"
Environment="XFYUN_API_KEY=%XFYUN_API_KEY%"

# ---- Context Map (optional, JSON) ----
Environment="CONTEXT_MAP=%CONTEXT_MAP%"

ExecStart=%NODE_PATH% %WORKDIR%/index.js --platform %PLATFORM%
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
