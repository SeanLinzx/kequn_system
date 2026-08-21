#!/usr/bin/env bash
cd /www/kequn/system-node/server
export PORT=5201
export JWT_SECRET=kequn-dev-secret-2026
exec node index.mjs
