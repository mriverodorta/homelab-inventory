#!/usr/bin/env bun
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyCiReceipt } from './receipt.mjs'
import { releasePaths } from '../local-release/config.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const expectedRevision = process.argv.slice(2).find((argument) => argument !== '--')
const receipt = await verifyCiReceipt({ root, receiptFile: releasePaths().ciReceiptFile, expectedRevision })
console.log(`Verified local CI receipt for ${receipt.revision}.`)
