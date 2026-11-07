#!/usr/bin/env bash
set -euo pipefail

# Màu sắc hiển thị terminal
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() { echo -e "${BLUE}==>${NC} $1"; }
log_success() { echo -e "${GREEN}✔${NC} $1"; }
log_warn() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✖${NC} $1"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

log_info "Bắt đầu triển khai và phát hành phiên bản mới cho Extension..."

# 1. Chạy Unit Tests để đảm bảo chất lượng code
log_info "1. Kiểm tra Unit Tests..."
if command -v node >/dev/null 2>&1; then
  node --test tests/profile-pages-sync.test.cjs
  log_success "Toàn bộ Unit Tests đã vượt qua thành công."
else
  log_warn "Node.js chưa được cài đặt hoặc không tìm thấy, bỏ qua chạy test."
fi

# 2. Tự động tăng version trong manifest.json (nếu không truyền version cụ thể)
CURRENT_VER=$(node -e "console.log(require('./manifest.json').version || '1.0.0')")
NEW_VER=$(node -e "
  const parts = '$CURRENT_VER'.split('.').map(Number);
  parts[parts.length - 1] = (parts[parts.length - 1] || 0) + 1;
  console.log(parts.join('.'));
")

TARGET_VER="${1:-$NEW_VER}"

log_info "2. Nâng cấp phiên bản: ${CURRENT_VER} -> ${TARGET_VER}"
node -e "
  const fs = require('fs');
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  manifest.version = '$TARGET_VER';
  fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');
"
log_success "Đã cập nhật manifest.json lên version ${TARGET_VER}"

# 3. Đóng gói file zip extension
log_info "3. Đóng gói file zip extension..."
ZIP_NAME="bug-sync-facebook-v${TARGET_VER}.zip"
rm -f "$ZIP_NAME"
zip -q -r "$ZIP_NAME" . \
  -x "*.git*" \
  -x "tests/*" \
  -x "request/*" \
  -x "*.zip" \
  -x ".DS_Store" \
  -x "*.sh"
log_success "Đã tạo bản build nén: ${ZIP_NAME}"

# 4. Commit & Push lên GitHub
COMMIT_MSG="${2:-release: update bug sync - facebook to v${TARGET_VER}}"
log_info "4. Commit và Push mã nguồn lên GitHub..."
git add -A
if ! git diff --cached --quiet; then
  git commit -m "$COMMIT_MSG"
  log_success "Đã commit: \"$COMMIT_MSG\""
else
  log_info "Không có thay đổi mã nguồn mới để commit."
fi

git push origin main
log_success "Đã push thành công lên GitHub repo!"

echo ""
echo -e "${GREEN}====================================================${NC}"
echo -e "${GREEN}✔ Triển khai Extension v${TARGET_VER} hoàn tất!${NC}"
echo -e "${GREEN}====================================================${NC}"
echo ""
