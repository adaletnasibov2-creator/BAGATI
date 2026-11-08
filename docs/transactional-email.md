# BAGATI transactional email

The application writes business-event messages to the PostgreSQL `EmailOutbox` inside the transaction that commits the corresponding event. A separate worker sends queued messages. Registration and business actions therefore do not wait for SMTP; API responses report that verification mail is **pending**, not delivered.

Password recovery uses the same outbox/SMTP worker. A reset request returns a generic accepted response and never claims provider acceptance; delivery state is visible only after the worker processes the message. Reset links contain a cryptographically random, 30-minute, single-use token. The `PasswordResetToken` table stores only its SHA-256 hash; the raw token exists only in the encrypted outbox payload and in the email.

## Configuration

Set these server-only values in the deployment environment (or local `.env`, which must not be committed):

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your-sending-address@gmail.com
SMTP_PASSWORD=your-Google-App-Password
SMTP_FROM=BAGATI <your-sending-address@gmail.com>
```

For Gmail with 2-Step Verification, `SMTP_PASSWORD` must be a Google App Password, never the account sign-in password. Port 465 uses implicit TLS; port 587 uses STARTTLS. Certificate verification remains enabled.

`SESSION_SECRET` must already be a random value of at least 32 characters. `EMAIL_ENCRYPTION_KEY` is optional; when set, use exactly 32 random bytes encoded as base64 or 64 hexadecimal characters. It encrypts all queued message payloads, including verification codes. If omitted, a domain-separated key is derived from `SESSION_SECRET`; keep the secret stable across deployments and backups. Rotating either key without re-encrypting pending rows makes those rows unreadable.

Set `APP_BASE_URL` to the canonical BAGATI origin used in password-recovery links (for example, the origin only, with no path or trailing route). Production requires HTTPS. This is server-only and must not use a `NEXT_PUBLIC_` name.

| Environment-variable name | Purpose | Required state |
| --- | --- | --- |
| `DATABASE_URL` | Existing PostgreSQL database target | Required; preserve the current target |
| `SESSION_SECRET` | Session signing, rate-limit identity hashing, and fallback outbox encryption | Required; at least 32 characters |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Server-side SMTP delivery | Required for provider delivery; accepted ports are 465 and 587 |
| `APP_BASE_URL` | Canonical HTTPS origin for verification/recovery links | Required in production; local HTTP is allowed only for localhost development |
| `EMAIL_ENCRYPTION_KEY` | Optional 32-byte encryption key for outbox payloads | Optional; if set, stable across web and worker processes |

The additive migration `20261014003000_secure_account_recovery` creates hashed reset-token and HMAC-keyed rate-limit tables and a case-insensitive normalized-email unique index. Review it and take/verify a database backup before applying it; it is not safe to deploy the recovery endpoints against a database that has not applied the migration.

## Worker and checks

The Next.js web server only queues messages; it does not start the email worker. Without a worker, verification messages remain `PENDING` and no code is sent.

For local development, use two PowerShell terminals from the BAGATI project directory:

1. Terminal 1: `npm.cmd run dev`
2. Terminal 2: `npm.cmd run email:worker:watch`

The watch worker checks the outbox every 30 seconds, processes up to 25 ready messages per poll, and stops cleanly with Ctrl+C. It uses the same `.env`/process environment as the web app. If the local Node process needs Windows system certificates, set `$env:NODE_USE_SYSTEM_CA="1"` in **both** terminals before starting their commands; TLS certificate validation remains enabled.

### Windows istehsalatında worker-in Task Scheduler ilə işlədilməsi

`npm.cmd run dev` və `npm.cmd run start` email worker-i başlatmır. Worker-i Next.js serverindən və Cloudflare Tunnel-dən ayrı, Windows Task Scheduler vasitəsilə işlədin. Bu layihədə Task Scheduler tapşırığı əvvəlcədən yaradılmayıb; aşağıdakı sazlamalar serverdə ayrıca edilməlidir.

1. **Layihə qovluğunu müəyyən edin.** `Start in` sahəsində layihənin istehsalatda yerləşdiyi kök qovluğu göstərin. Hazırkı iş sahəsinin yolu `C:\Users\Lenovo\Desktop\BAGATI`-dir; istehsalat nüsxəsi başqa yerdədirsə, həmin həqiqi yolu yazın. İşçi və health yoxlaması eyni serverdə, eyni layihə qovluğundan işləməlidir.
2. **Worker tapşırığı yaradın.** Task Scheduler-də *Create Task* seçin. *General* bölməsində server açıldıqda istifadəçi daxil olmadan işləyə bilən, layihə qovluğuna və onun mühit parametrlərinə çıxışı olan Windows hesabını seçin. *Triggers* bölməsində *At startup* əlavə edin.
3. **Worker əməliyyatını təyin edin.** *Actions* bölməsində *Program/script* sahəsinə Windows `cmd.exe`-nin tam yolunu (adətən `C:\Windows\System32\cmd.exe`) yazın. *Add arguments* sahəsində `npm.cmd`-in hostdakı tam yolunu tapıb bu arqument formasından istifadə edin: `/d /s /c ""C:\Path\to\npm.cmd" run email:worker:watch"`. `C:\Path\to\npm.cmd`-i serverdəki həqiqi npm yolu ilə əvəz edin. *Start in* sahəsinə 1-ci addımdakı layihə kökünü yazın. Başladılan əmr `npm.cmd run email:worker:watch` olmalıdır.
4. **Daimi işləməni və təkrar başlatmanı sazlayın.** *Settings* bölməsində tapşırığın tələb üzrə dayandırılmasına icazə verin, uzun işləyən tapşırığa vaxt həddi qoymayın və xəta ilə dayandıqda yenidən başladılmasını aktiv edin (məsələn, hər 1 dəqiqədən bir; mümkün olan ən uzun cəhd müddətini seçin). *If the task is already running* seçimində *Do not start a new instance* seçin. Bu parametr Task Scheduler vasitəsilə ikinci nüsxənin başlamasını önləyir; eyni worker-i ayrıca terminaldan və ya başqa xidmət tapşırığından paralel başlatmayın. Worker daxili poll xətasından sonra proses kimi işləməyə davam edə bilər; bu halda tapşırıq yenidən başlamaz, health yoxlaması xəbərdarlıq verməlidir.
5. **Health yoxlaması üçün ayrıca tapşırıq yaradın.** Başqa bir tapşırıqda eyni Windows hesabını və eyni *Start in* layihə qovluğunu istifadə edin. *Program/script* sahəsində yenə `cmd.exe`-nin tam yolunu göstərin. *Add arguments* sahəsində `npm.cmd`-in hostdakı tam yolunu eyni qaydada, bu əmrlə istifadə edin: `/d /s /c ""C:\Path\to\npm.cmd" run email:worker:health"`. `C:\Path\to\npm.cmd` yolunu serverdəki həqiqi yolla əvəz edin. *Trigger* olaraq gündəlik başlama vaxtı təyin edib təkrarı 1 dəqiqəyə, müddəti isə qeyri-məhdud davam etməyə sazlayın. Bu əmr PostgreSQL-dən yalnız oxu məlumatı alır; DB-yə qoşula bilməsə, qeyri-sıfır çıxış kodu ilə bitir. Health tapşırığında hər dəqiqə yeni nüsxə açılmasının qarşısını almaq üçün *If the task is already running* seçimini *Do not start a new instance* edin.
6. **İcazələri və məxfi məlumatları qoruyun.** Seçilmiş Windows hesabına Node.js/`npm.cmd`-i işə salmaq, layihə fayllarını oxumaq, `.env`-dəki mühit dəyişənlərindən istifadə etmək və layihə kökündəki `.runtime` qovluğuna yazmaq üçün zəruri hüquqlar verin. `.env` və hesab etimadnamələrini digər istifadəçilərdən qoruyun; onları tapşırıq arqumentlərinə, skriptlərə və loglara köçürməyin. Tapşırığı məhdud hüquqlu, xüsusi Windows hesabı ilə işlədin.
7. **Tapşırıqların vəziyyətini izləyin.** Task Scheduler-in *History* bölməsində başlanma, dayanma və çıxış kodlarına baxın. Xəbərdarlıqların məsul şəxsə çatması üçün ayrıca izləmə və bildiriş quruluşu tələb olunur; Task Scheduler-in tarixçəsi öz-özünə etibarlı xəbərdarlıq kanalı sayılmır.

Watch worker hər 30 saniyədə növbəni yoxlayır, `.runtime/email-worker-health.json` heartbeat faylını 20 saniyədən bir yeniləyir və normal `Ctrl+C`/dayandırma zamanı `stoppedAt` qeyd edir. Worker qəfil bağlanarsa, bu qeyd yazılmaya bilər; köhnəlmiş heartbeat aşkarlanması 90 saniyəlik həddən sonra xəbərdarlıq verir. Hazırda emala yararlı `PENDING` məktub 5 dəqiqədən çox növbədə qalarsa, ayrıca xəbərdarlıq yaranır.

Health əmri heartbeat, son uğurlu yoxlama, növbə sayları və bəzi konfiqurasiya göstəricilərini yoxlayır. Xəbərdarlıq varsa və ya DB sorğusu uğursuz olarsa, qeyri-sıfır çıxış kodu verir. Xəbərdarlıqlara əvvəlki `FAILED` məktublar da daxildir; bunlar mütləq cari prosesin dayanması demək deyil. Health yoxlaması SMTP bağlantısını sınamır və məktubun alıcının poçt qutusuna çatdığını təsdiqləmir. SMTP `configured` olması yalnız sazlamanın mövcudluğunu bildirir, çatdırılmanı yox. Çıxış kodu özü ayrıca bildiriş göndərmir.

Heartbeat host və iş qovluğuna bağlıdır; worker və health tapşırığı fərqli qovluqlardan başlasa, health worker-in heartbeat faylını görməyəcək və `worker_not_observed` xəbərdarlığı verəcək. Server dəyişdirilərsə, `.runtime` faylı yeni serverə daşınmır. Çox serverli quruluşda hər worker-i həmin serverdə izləmək və nəticələri mərkəzi monitorinq sisteminə ötürmək lazımdır.

When a worker delivery fails, its log includes the processing stage, allowlisted failure code and type, plus sanitized SMTP metadata where available. It never logs the raw error message, recipient, payload, or verification code. For example, `stage=decode_payload` with `EMAIL_PAYLOAD_DECRYPT_FAILED` indicates that a queued payload could not be decrypted; an allowlisted `PRISMA_Pxxxx` code identifies a Prisma error without exposing its message. Older failed rows only retain their persisted `lastErrorCode`; their original exception cannot be reconstructed from aggregate health output.

Generated `Message-ID` headers use the configured sender's fully qualified domain rather than a local-only hostname. For production alignment, configure `SMTP_FROM` with the verified sending domain; this header setting does not replace SPF, DKIM, or DMARC configuration.

For a one-time batch, `npm.cmd run email:worker` processes up to 25 currently ready messages and exits. **This command can send every eligible message in the configured outbox**, not just a test message. Do not use it as a targeted delivery test against a shared or production database. The watch command also sends all eligible queued messages.

To process one already-approved message without sending other pending messages, use `npm.cmd run email:worker -- --id <outbox-id>`. This one-shot mode selects and claims only that row, and any stale-lock cleanup is restricted to the same row. It does not support `--watch`. Confirm the row is the intended message before running it; the worker still validates the current template and reset/verification token before sending.

## Real-message verification

The following command sends **one real diagnostic email** to the supplied address without reading or changing the outbox:

```powershell
npm.cmd run email:test-send -- you@example.com
```

Replace the example with an address you control. Do not run this command until the BAGATI owner has explicitly approved sending a message to that address. A successful result means only that the SMTP provider accepted the recipient; check that inbox and its spam folder to confirm receipt. The message is a diagnostic, not an account verification code.

To verify the complete registration flow afterward, use a dedicated test database and a test SMTP account/address you control. Starting `npm.cmd run email:worker:watch` sends all eligible messages in that database, so do not start it against a shared database unless every queued recipient is intentionally in scope and sending those messages has been approved. Confirm the verification row is accepted by the provider, then verify the code in the app and check inbox/spam. Do not use an SMTP connection check as proof of actual mail delivery.

The admin panel's **Email çatdırılması** page shows whether the required SMTP variables are present and the outbox state; it never shows recipients, payloads, or secrets. Only failures known to occur before acceptance (or explicit temporary SMTP 4xx responses) can be retried. Authentication/configuration failures and ambiguous outcomes are not automatically retried.

SMTP acceptance is not proof of inbox delivery. This implementation uses a stable message ID and a database dedupe key, but SMTP plus PostgreSQL cannot guarantee exactly-once delivery across a process crash after SMTP acceptance and before the `SENT` update. Such stale jobs are marked with an unknown outcome and are not automatically resent to avoid duplicate messages.

## Scope

Verification, password reset, customer/seller welcome, seller application and store review, orders and shipment, returns, subscription state, and password-change messages use the existing outbox. External payment/refund-provider integrations are separate and are not implied by email delivery. Refund-status email is generated only when the existing return workflow changes to an actual refund-related status.
