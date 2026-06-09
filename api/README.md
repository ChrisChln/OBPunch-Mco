简要说明

该目录包含面向服务器的 API 端点（serverless 风格）。环境变量：
- `SUPABASE_URL`：Supabase 项目 URL
- `SUPABASE_SERVICE_ROLE_KEY`：Supabase service_role key（请仅在服务器端使用）
- `ADMIN_TOKEN`：用于管理 API 的简单静态令牌（通过 `Authorization: Bearer <ADMIN_TOKEN>` 进行验证）

已实现端点：
- `POST /api/punch`：前台打卡写入。服务端使用 service role 校验员工、离职状态、排班专用 agency、上一笔 IN/OUT 顺序，然后写入 `ob_punches`。请求 JSON:
  - `staff_id`: string (`US` + 3-12 位数字)
  - `action`: "IN" | "OUT"
- `POST /api/corrections`：管理员追加修正（向 `ob_punches` 插入一条记录）。请求 JSON:
  - `staff_id`: string (3-12 数字)
  - `action`: "IN" | "OUT"
  - `effective_at`?: ISO 时间字符串 或 null
  - `note`?: string
- `POST /api/leave-sync`：Google Form / Google Sheet 请假同步。请求头：
  - `Authorization: Bearer <GOOGLE_SHEET_SYNC_TOKEN>`（未配置时回退 `ADMIN_TOKEN`）
  - JSON: `{ rows: [...] }` 或 `{ row: {...} }`
  - 每行至少需要：
    - `Name/ Nombre` 或 `Name`
    - `Off Date / Fecha del` 或 `Off Date`
    - `Type of Leave/Tipo de permiso` 或 `Type of Leave`
  - 可选：
    - `Employee ID / ID del`
    - `Position`
    - `是否完成排班调整`
    - `时间戳记` / `Timestamp`
    - `sheet_id` / `sheet_name` / `row_number`（推荐，用于生成稳定唯一键）

返回：
- 200: { status: 'ok' }
- 4xx/5xx: { error: 'message' }

部署说明：
在 Vercel/Netlify 等平台上部署时将环境变量注入到运行环境。不要在前端暴露 `SUPABASE_SERVICE_ROLE_KEY`。
前台打卡依赖 `/api/punch`。本地只运行 `npm run dev` 时 Vite 不会直接提供 serverless API；需要通过 Vercel dev/API 服务或部署环境测试完整打卡写入。
Google Sheet 直连建议用 Apps Script 调用 `/api/leave-sync`，示例脚本见 `scripts/google-leave-sync.gs`。







