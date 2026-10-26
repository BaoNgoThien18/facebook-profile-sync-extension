# BugLab Facebook Profile & Page Sync Extension

Extension Chrome (Manifest V3) chuyên dụng để đồng bộ danh tính cá nhân (Facebook Profile) và các Fanpage quản trị lên hệ thống **Fb Sheet Manager By BugLab** (`https://facebook.buglab.vn`).

## ✨ Tính năng chính

- 🚀 **Trích xuất thông minh (3 cơ chế dự phòng)**: Tự động trích xuất DTSG, LSD và UID trực tiếp qua API nội bộ Facebook, ProfileSwitcher GraphQL, Ads Token Graph API hoặc mbasic HTML.
- 🔑 **Cấu hình User Token cá nhân**: Nhân viên nhập API Token riêng của mình tại mục **"Cài đặt"** trên extension. Dữ liệu khi đồng bộ lên hệ thống sẽ được tự động gán cho nhân viên đó và Leader trực tiếp quản lý.
- ⚡ **Đồng bộ chủ động (Manual On-Demand)**: Chỉ chạy khi bấm nút **"Đồng bộ ngay"**, không gây nặng trình duyệt hay chạy ngầm tiêu tốn tài nguyên.
- 🛡️ **Bảo mật và an toàn**: Sử dụng Declarative Net Request (DNR) Rules để bảo đảm an toàn request API Facebook, không gửi mật khẩu hay cookie ra bên ngoài.

---

## 🛠 Hướng dẫn cài đặt cho Nhân viên

1. **Tải mã nguồn**:
   - Tải file zip hoặc clone repository này về máy tính:
     ```bash
     git clone https://github.com/BaoNgoThien18/facebook-profile-sync-extension.git
     ```
   - Nếu tải file zip, hãy giải nén ra một thư mục cố định.

2. **Cài vào trình duyệt (Chrome, Cốc Cốc, Brave, ShardBrowser...)**:
   - Mở trình duyệt và truy cập: `chrome://extensions/`
   - Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
   - Nhấn nút **Tải tiện ích đã giải nén (Load unpacked)**.
   - Chọn thư mục extension vừa giải nén.

3. **Cấu hình Token nhân viên**:
   - Truy cập trang quản trị [facebook.buglab.vn/sheet?tab=users](https://facebook.buglab.vn/sheet?tab=users) và đăng nhập bằng tài khoản của bạn.
   - Tại dòng tài khoản của bạn, nhấn nút **Copy Token** (hoặc tạo mới nếu chưa có).
   - Nhấp vào biểu tượng Extension trên thanh công cụ để mở giao diện làm việc.
   - Chọn mục **"Cài đặt"** ở menu bên trái -> Dán Token vào ô **API Token của nhân viên** -> Nhấn **"Lưu Token"**.

4. **Tiến hành đồng bộ**:
   - Đảm bảo bạn đã đăng nhập Facebook cá nhân trên trình duyệt.
   - Mở extension, tại tab **"Đồng bộ"**, bấm nút **"Đồng bộ ngay"**.
   - Profile và danh sách toàn bộ Fanpage bạn quản lý sẽ được lưu tức thì lên bảng tính quản trị của công ty.

---

## 🧪 Kiểm thử (Unit Tests)

Chạy kiểm tra toàn bộ 21 test case của extension:
```bash
node --test tests/profile-pages-sync.test.cjs
```
