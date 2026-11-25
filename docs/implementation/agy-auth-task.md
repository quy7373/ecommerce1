# Lệnh giao việc cho agy — AUTH-002

Trạng thái: đủ điều kiện bàn giao; Orchestrator đã được user chỉ định CLI agy. Chỉ cập nhật đã gọi sau khi lệnh thật sự được thực thi; thoát CLI không tự chứng minh code/tests hoàn tất.

## Quyền triển khai và ràng buộc Orchestrator

User đã yêu cầu Orchestrator gọi agy triển khai AUTH-002 theo tài liệu này. Trong lần gọi này, agy được giao thay đổi AUTH-002 trong backend/ và frontend/, cùng tài liệu báo cáo trong docs/; quy tắc phân vai dưới đây vẫn áp dụng với các agent khác đang làm việc. Kiểm tra hiện trạng trước khi sửa, giữ nguyên phần không thuộc AUTH-002, không ghi đè thay đổi mới của agent khác. Không cần dừng chỉ vì không có task Backend/Frontend để gửi tin.

Không xóa dữ liệu hoặc dùng prisma migrate reset/db push --accept-data-loss, DROP/TRUNCATE hoặc destructive migration khi chưa được phê duyệt. Có thể viết migration additive để review; chỉ chạy trên database test mới, riêng biệt, được xác nhận là disposable. Không đọc/in production secret hoặc thay đổi secret đang dùng; chỉ thêm tên cấu hình và giá trị dummy vào .env.example nếu cần. Không commit/merge/deploy hoặc sửa root config. Test dùng fake mail; không gửi email thật.

Ghi kết quả cuối cùng vào docs/implementation/auth-002-agy-result.md: file đã sửa, lệnh tests thật sự đã chạy, kết quả/skip/blocker, migration đã viết/chạy ở môi trường nào. Không tuyên bố hoàn tất nếu browser/API/mail-test hoặc real-PostgreSQL acceptance chưa được xác minh.

## Prompt triển khai

Bạn là agent triển khai AUTH-002 cho D:\Ecommerce. User yêu cầu làm đăng nhập, đăng ký, quên/reset mật khẩu. Đọc AGENTS.md và kiểm tra repo/status trước khi sửa. Đọc [kế hoạch](auth-implementation-plan.md), [API mở rộng](../api/email-password-auth-contract.md), [security gates](../security/security-requirements.md) và auth code hiện có.

Giữ Google OIDC/JWT cookie/session/logout. Thêm đăng ký hai bước email-first (register email -> link xác minh -> nhập tên/password -> tạo CUSTOMER), email/password login, forgot/reset bằng token random một lần. Không thêm local password cho Google-only hoặc auto-link bằng email. Dùng Argon2id, không trim mật khẩu, preauth Origin+CSRF, shared quotas, token hash/purpose/expiry, transactional session revocation và audit. API/schema/model đã được định nghĩa trong hai tài liệu, không tự tạo contract khác.

Backend: migration mới cho googleSubject nullable/emailVerifiedAt/PasswordCredential/AuthActionToken/AuthMailOutbox; auth service/routes/repository/validator; mail adapter worker encrypted outbox/fixed frontend fragment links; dummy env/README; Jest/Supertest và real PostgreSQL race tests. Reuse AuthSession/crypto/session factory, không copy logic JWT hoặc sửa init migration.

Frontend: mở rộng LoginPage và authApi/AuthContext; thêm Register/VerifyEmail/ForgotPassword/ResetPassword views và routes; accessible forms, confirmPassword client-only, token chỉ memory sau xóa fragment, không token storage/analytics, cùng thông báo chung cho account existence; Playwright mock và real-backend mail-test journeys. Giữ cart/checkout/order/Google hoạt động.

Tôn trọng ownership: Agent Backend chỉ backend/, Frontend chỉ frontend/, Architect docs/. Nếu bạn chưa được phân quyền cả hai thư mục, giao đúng agent phụ trách hoặc báo phạm vi cần phân công; không ghi đè file đang được agent khác sửa. Không tạo branch/worktree/commit/reset/merge/deploy hoặc sửa root configuration. Không gửi email thật trong tests, không commit secret, không dùng chatbot để làm recovery.

Chạy package scripts phù hợp hiện có: backend test:unit/test:integration; frontend typecheck/build/test:e2e. Dùng PostgreSQL test thật để chứng minh unique/lock/transaction/reset race; inMemoryPrisma/mocked Playwright không đủ. Nếu thiếu môi trường/dependency, báo command và blocker cụ thể, vẫn hoàn tất phần độc lập. Không tuyên bố production-ready khi MFA/privacy/deployment evidence chưa đủ.

Báo cáo Task ID, files changed, migration/model delta, tests executed/results/skips, known issues và commit hash (không tạo commit). Chỉ báo xong khi ba luồng qua browser/API/mail-test đạt acceptance của kế hoạch.

## Metadata để người điều phối cập nhật

- Task ID: AUTH-002; subtasks AUTH-BE-01..03, AUTH-FE-01..02, AUTH-QA-01, AUTH-OPS-01.
- Recipient: agy CLI tại `$env:LOCALAPPDATA\agy\bin\agy.exe`, do user cung cấp.
- Thời điểm gọi/receipt: 2026-11-23, lệnh PowerShell đã thực thi thật; lần sandbox bị Access denied khi ghi trạng thái Antigravity và đã dừng. Lần require_escalated chạy TTY nhận prompt AUTH-002, đọc tài liệu và kiểm tra repo; execution session38811. Chưa có xác nhận hoàn tất.
- Acknowledgement/implementation/test evidence: chưa có.
