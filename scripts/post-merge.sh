#!/bin/bash
set -e

# Runs automatically after a task merge: install deps and sync DB schema.
npm install
npm run db:push -- --force
