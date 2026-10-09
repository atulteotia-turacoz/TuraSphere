#!/bin/bash
# TuraQuant - Production Deployment Script
# Run this ON the cloud server after uploading the project files.
#
# Prerequisites on the server:
#   - Ubuntu 22.04+ / Debian 12+
#   - sudo access
#
# Usage: sudo bash deploy.sh

set -e

# ─── Configuration ───────────────────────────────────────
DOMAIN="turaquant.turacoz.com"
APP_DIR="/var/www/turaquant"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
DB_NAME="turaquant_db"
DB_USER="turaquant_user"
DB_PASS=""  # Will prompt if empty

echo "==========================================="
echo "  TuraQuant — Production Deployment"
echo "==========================================="
echo "  Domain:  https://$DOMAIN"
echo "  App Dir: $APP_DIR"
echo "==========================================="
echo ""

# ─── 1. Install System Dependencies ─────────────────────
echo "[1/9] Installing system dependencies..."
apt update -y
apt install -y python3 python3-pip python3-venv mysql-server nginx certbot python3-certbot-nginx curl nodejs npm

# CV reading for accounts with AI turned off. Without these an image-only PDF or
# a legacy binary .doc/.ppt cannot be read at all on such an account — there is
# no model to fall back to. All three are local tools; nothing is uploaded.
#   tesseract-ocr   OCR for scanned CVs        (pytesseract)
#   poppler-utils   renders PDF pages for OCR  (pdf2image needs pdftoppm)
#   libreoffice     converts legacy .doc/.ppt  (python-docx/pptx read only the
#                                               modern zipped XML formats)
echo "  Installing CV reading tools (OCR + legacy Office conversion)..."
apt install -y tesseract-ocr poppler-utils libreoffice

# Install Node 20+ if system version is too old
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 18 ]; then
    echo "  Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

echo "  Node: $(node -v), npm: $(npm -v), Python: $(python3 --version)"

# Say so loudly here rather than letting a CV upload fail months later with an
# error nobody connects back to provisioning.
for tool in tesseract pdftoppm soffice; do
    command -v "$tool" >/dev/null 2>&1 \
        && echo "  OK      $tool: $(command -v $tool)" \
        || echo "  WARNING $tool missing — CVs will not be readable with AI off"
done

# ─── 2. Create App Directory ────────────────────────────
echo "[2/9] Setting up app directory..."
mkdir -p $APP_DIR/{frontend,admin,backend,uploads}
chown -R www-data:www-data $APP_DIR/uploads

# ─── 3. Setup MySQL Database ────────────────────────────
echo "[3/9] Setting up MySQL database..."
if [ -z "$DB_PASS" ]; then
    read -s -p "  Enter password for MySQL user '$DB_USER': " DB_PASS
    echo ""
fi

mysql -u root <<EOF
CREATE DATABASE IF NOT EXISTS $DB_NAME CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$DB_PASS';
GRANT ALL PRIVILEGES ON $DB_NAME.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
EOF
echo "  Database '$DB_NAME' ready."

# ─── 4. Deploy Backend ──────────────────────────────────
echo "[4/9] Deploying backend..."
cp -r "$PROJECT_DIR/backend/"* $APP_DIR/backend/
cp -r "$PROJECT_DIR/backend/.env.production" $APP_DIR/backend/.env

# Update database URL in .env with actual credentials
sed -i "s|CHANGE_THIS_PASSWORD|$DB_PASS|g" $APP_DIR/backend/.env

# Generate a random secret key
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
sed -i "s|CHANGE_THIS_TO_A_RANDOM_64_CHAR_STRING|$SECRET_KEY|g" $APP_DIR/backend/.env

# Create virtual environment and install deps
cd $APP_DIR/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt 2>/dev/null || pip install fastapi uvicorn sqlalchemy pymysql pydantic pydantic-settings python-jose passlib bcrypt python-multipart httpx beautifulsoup4 networkx openai anthropic python-docx PyPDF2 reportlab
deactivate

chown -R www-data:www-data $APP_DIR/backend
echo "  Backend deployed."

# ─── 5. Build & Deploy Frontend ─────────────────────────
echo "[5/9] Building frontend..."
cd "$PROJECT_DIR/frontend"
npm ci --production=false
npm run build
cp -r build/* $APP_DIR/frontend/
echo "  Frontend built and deployed."

# ─── 6. Build & Deploy Admin ────────────────────────────
echo "[6/9] Building admin panel..."
cd "$PROJECT_DIR/admin"
npm ci --production=false
npm run build
cp -r build/* $APP_DIR/admin/
echo "  Admin panel built and deployed."

# ─── 7. Setup Nginx ─────────────────────────────────────
echo "[7/9] Configuring Nginx..."
cp "$PROJECT_DIR/deployment/nginx/turaquant.conf" /etc/nginx/sites-available/turaquant.conf
ln -sf /etc/nginx/sites-available/turaquant.conf /etc/nginx/sites-enabled/turaquant.conf

# Remove default site if it exists
rm -f /etc/nginx/sites-enabled/default

# Test nginx config (use HTTP-only temporarily for SSL setup)
# Create a temporary HTTP-only config for certbot
cat > /etc/nginx/sites-available/turaquant.conf <<'NGINX'
server {
    listen 80;
    server_name turaquant.turacoz.com;
    root /var/www/turaquant/frontend;

    location /.well-known/acme-challenge/ {
        root /var/www/turaquant/frontend;
    }

    location / {
        return 200 'TuraQuant is being configured...';
        add_header Content-Type text/plain;
    }
}
NGINX

nginx -t
systemctl restart nginx
echo "  Nginx configured (HTTP)."

# ─── 8. SSL Certificate ─────────────────────────────────
echo "[8/9] Obtaining SSL certificate..."
certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@turacoz.com --redirect || {
    echo "  WARNING: Certbot failed. You may need to run it manually:"
    echo "    sudo certbot --nginx -d $DOMAIN"
    echo "  Continuing with HTTP-only for now..."
}

# Now install the real nginx config with SSL
cp "$PROJECT_DIR/deployment/nginx/turaquant.conf" /etc/nginx/sites-available/turaquant.conf
nginx -t && systemctl reload nginx
echo "  SSL configured."

# ─── 9. Setup Systemd Service ───────────────────────────
echo "[9/9] Setting up backend service..."
cp "$PROJECT_DIR/deployment/turaquant-backend.service" /etc/systemd/system/turaquant-backend.service
systemctl daemon-reload
systemctl enable turaquant-backend
systemctl start turaquant-backend
echo "  Backend service started."

# ─── Done ────────────────────────────────────────────────
echo ""
echo "==========================================="
echo "  TuraQuant Deployment Complete!"
echo "==========================================="
echo ""
echo "  Frontend:  https://$DOMAIN"
echo "  Admin:     https://$DOMAIN/admin"
echo "  API:       https://$DOMAIN/api/v1"
echo "  API Docs:  https://$DOMAIN/docs"
echo ""
echo "  Default Admin: admin@tura.com / Admin@123"
echo ""
echo "  Useful commands:"
echo "    sudo systemctl status turaquant-backend"
echo "    sudo journalctl -u turaquant-backend -f"
echo "    sudo systemctl restart turaquant-backend"
echo "    sudo nginx -t && sudo systemctl reload nginx"
echo "==========================================="
