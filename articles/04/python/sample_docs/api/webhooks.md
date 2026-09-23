---
title: SampleCloud Webhook 仕様
category: api
---
# SampleCloud Webhook 仕様

## 署名の検証
Webhook のリクエストには X-Sample-Signature ヘッダーが付く。値は、リクエストボディを Webhook シークレットで HMAC-SHA256 署名したものである。受信側はこの署名を検証し、一致しないリクエストを破棄すること。

## タイムアウトとリトライ
受信側は10秒以内に 2xx のステータスコードを返す必要がある。それ以外の応答やタイムアウトは失敗とみなし、1分、2分、4分、8分、16分の間隔で最大5回まで再送する。
