---
title: SampleCloud API エラーコード
category: api
---
# SampleCloud API エラーコード

## クライアントエラー
- 400 Bad Request：リクエストの形式が正しくない
- 401 Unauthorized：認証情報がない、または期限切れ
- 403 Forbidden：権限がない操作を行った
- 404 Not Found：対象のリソースが存在しない
- 409 Conflict：同じリソースを同時に更新しようとした
- 422 Unprocessable Entity：入力値の検証に失敗した
- 429 Too Many Requests：レート制限を超えた

## サーバーエラー
- 500 Internal Server Error：サーバー内部でエラーが発生した
- 503 Service Unavailable：メンテナンス中または一時的な過負荷。時間をおいて再試行すること
