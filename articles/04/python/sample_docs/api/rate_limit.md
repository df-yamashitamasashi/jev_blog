---
title: SampleCloud API レート制限
category: api
---
# SampleCloud API レート制限

## プラン別の上限
1分あたりのリクエスト数の上限は、Freeプランが60回、Standardプランが600回、Enterpriseプランが6,000回である。

## 瞬間的なリクエスト（バースト）
1秒あたりの上限は、Freeプランが5回、Standardプランが20回、Enterpriseプランが100回である。

## 上限を超えたとき
上限を超えると HTTP 429 が返る。レスポンスの Retry-After ヘッダーに、再試行できるまでの秒数が入る。
