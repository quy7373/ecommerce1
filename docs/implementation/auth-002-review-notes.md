# AUTH-002 — Điểm cần kiểm tra trước nghiệm thu

Review đang diễn ra trong khi agy triển khai; các mục sau chưa phải kết luận final về code cuối cùng.

1. SMTP transport phải fail closed nếu production không có TLS: secure implicit TLS hoặc requireTLS STARTTLS với certificate verification. Không chấp nhận plaintext downgrade/unknown transport tự rơi về fake mail. Kiểm tra startup config và test adapter, không gửi mail thật.
2. Token-expiry mail phải được kiểm tra theo thời điểm thực từng lần gửi; một batch có thể kéo dài hơn thời điểm now lúc claim. Mail lease/delivery tối thiểu at-least-once, không tuyên bố exactly-once vì crash sau SMTP send trước DB ack.
3. Error details.code trong password blocklist cần khớp hợp đồng ErrorBody: nếu dùng PASSWORD_BLOCKED, phải ghi rõ đây là enum mở rộng của AUTH-002 hoặc đổi về FORMAT; không để code/docs mâu thuẫn.
4. Đọc code transaction và chạy real PostgreSQL chứng minh reset/version/session race, không chỉ lời tự đánh giá hay inMemoryPrisma.
5. Chưa áp dụng migration lên dữ liệu hiện hữu; chỉ database test mới, riêng biệt. Giữ nguyên migrations init và không commit.
6. completePasswordResetTransaction đang khóa token trước credential rồi update các token khác. Hai reset dùng hai token cùng user có thể deadlock (mỗi transaction giữ token riêng, một chờ credential, một chờ token của bên kia). Cần lock-order thống nhất theo credential/user trước token mutations hoặc bounded retry, kèm real-PostgreSQL test hai token version giống nhau, không chỉ test replay cùng token.
7. Hợp đồng yêu cầu shared limiter across replicas. SlidingWindowRateLimiter in-memory không chứng minh được điều đó; xác minh wiring/budget DB-backed hoặc ghi rõ blocker và không báo đủ security acceptance. Không tự nới yêu cầu thành per-process.
