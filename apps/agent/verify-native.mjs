// Exercises the actual ACP adapter -> native model -> Gateway tool path.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
const child = spawn(process.execPath,['runtime/buildpack-acp.js'],{stdio:['pipe','pipe','inherit']});
let text = '', completedTools = 0, done = false;
const send = (id,method,params) => child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
const timer = setTimeout(()=>{console.error('Native ACP probe timed out');child.kill();process.exitCode=1;},90000);
const lines = createInterface({input:child.stdout});
lines.on('line',line=>{
  const message = JSON.parse(line);
  if (message.error) {console.error('Native ACP probe request failed');child.kill();process.exitCode=1;return;}
  if (message.id===1) send(2,'session/new',{cwd:process.cwd(),mcpServers:[]});
  if (message.id===2) send(3,'session/prompt',{sessionId:message.result.sessionId,prompt:[{type:'text',text:'Call the read_pilot_document tool for architecture. Reply with PROBE followed by the exact backend-generated nonce from that tool result. You must actually call the tool.'}]});
  const update = message.params?.update;
  if (update?.sessionUpdate==='agent_message_chunk') text += update.content?.text || '';
  if (update?.sessionUpdate==='tool_call_update' && update.status==='completed') completedTools++;
  if (message.id===3) {
    const nonce = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    done = completedTools>0 && !!nonce && message.result.stopReason==='end_turn';
    console.log(JSON.stringify({check:'native-acp-gateway',passed:done,completedTools,nonce,stopReason:message.result.stopReason}));
    child.stdin.end();
    if (!done) process.exitCode=1;
  }
});
child.on('exit',()=>{clearTimeout(timer);lines.close();if(!done)process.exitCode=1;});
child.on('error',()=>{clearTimeout(timer);console.error('Native ACP bridge did not start');process.exitCode=1;});
send(1,'initialize',{protocolVersion:1,clientCapabilities:{}});
