// Non-agent acceptance task: a sentinel survives ws restore in fresh CF containers.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, isAbsolute } from 'node:path';
const root = process.env.BUZZ_STATE_ROOT;
if (!root || !isAbsolute(root)) throw new Error('Restored private state root is required');
const path = join(root,'.pilot-state-check.json');
if (process.argv[2] === 'write') writeFileSync(path,JSON.stringify({nonce:randomUUID()}),{mode:0o600});
else if (!['read','hold'].includes(process.argv[2])) throw new Error('Expected write, read or hold');
const {nonce} = JSON.parse(readFileSync(path,'utf8'));
console.log(JSON.stringify({check:'pilot-state',mode:process.argv[2],nonce,task_has_instance_index:process.env.CF_INSTANCE_INDEX !== undefined,state_credentials_present:!!process.env.WS_STATE_S3_SECRET_KEY}));
if (process.argv[2] === 'hold') setTimeout(()=>{},30000);
