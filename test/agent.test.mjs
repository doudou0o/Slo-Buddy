import test from 'node:test';
import assert from 'node:assert/strict';
import { collectResponse } from '../src/agent.mjs';
test('returns on completed turn without waiting for process shutdown and closes stream', async () => {
  let closed = false;
  async function* stream() {
    try {
      yield {type:'item.completed', item:{type:'agent_message',text:'OK'}};
      yield {type:'turn.completed'};
      throw new Error('must not await process shutdown');
    } finally { closed = true; }
  }
  assert.equal(await collectResponse(stream()), 'OK');
  assert.equal(closed, true);
});
test('failed turns are not returned as successful answers', async () => {
  async function* stream() { yield {type:'turn.failed',error:{message:'failure'}}; }
  await assert.rejects(collectResponse(stream()), /failure/);
});
test('reconnection notice does not cancel a CLI stream that later succeeds',async()=>{async function* stream(){yield {type:'error',message:'Reconnecting... 2/5 (request timed out)'};yield {type:'item.completed',item:{type:'agent_message',text:'recovered'}};yield {type:'turn.completed'};}assert.equal(await collectResponse(stream()),'recovered');});
test('reconnect followed by stream end is still failure, never partial success',async()=>{async function* stream(){yield {type:'error',message:'Reconnecting... 2/5 (request timed out)'};yield {type:'item.completed',item:{type:'agent_message',text:'partial'}};}await assert.rejects(collectResponse(stream()),/Reconnecting/);});
test('unrecognized errors remain fatal',async()=>{async function* stream(){yield {type:'error',message:'authentication failed'};}await assert.rejects(collectResponse(stream()),/authentication failed/);});
