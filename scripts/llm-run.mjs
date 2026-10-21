import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const home = os.homedir();
const ensure = (condition, message) => { if (!condition) throw new Error(message); };
async function main() {
  const phase = process.argv[2] || 'plan';
  ensure(['plan', 'qualify', 'run'].includes(phase), 'Use plan, qualify or run.');
  const target = JSON.parse(fs.readFileSync(path.join(repository, 'ansible/vars/llm.json'), 'utf8'));
  ensure(target.host === '10.0.10.5' && target.model_directory === '/mnt/ssd/appdata/llm-models', 'Unexpected worker/storage scope.');
  ensure(/^ollama\/ollama:0\.40\.7@sha256:[a-f0-9]{64}$/.test(target.image), 'Use the reviewed immutable image.');
  ensure(target.model === 'qwen2.5:3b' && target.context_tokens === 4096 && target.localhost_port === 11435, 'Use the fixed qualified model and private port.');
  ensure(target.cpus === 2 && target.memory_limit_mib === 6144 && target.minimum_free_vram_mib === 4096, 'Preserve the bounded worker budget.');
  ensure(target.modes.brief.output_tokens === 160 && target.modes.brief.passes === 1 && target.modes.careful.output_tokens === 512 && target.modes.careful.passes === 2, 'Unexpected inference mode budget.');
  let job = { mode: 'brief', prompt: 'Write a short factual morning summary using only this context. Do not add predictions.', context: { weather: 'Light rain, 8 C', events: ['Bin collection today', 'One person detected at the office entrance yesterday'] } };
  if (phase === 'run') {
    let text = '';
    for await (const part of process.stdin) text += part;
    ensure(Buffer.byteLength(text) <= 3000, 'Job input exceeds the conservative 3000-byte limit.');
    job = JSON.parse(text);
  }
  const profile = job.profile || process.argv[3] || 'balanced';
  ensure(['balanced', 'fast'].includes(profile) && Object.hasOwn(target.profiles, profile), 'Use an allowlisted balanced or fast profile.');
  const selected = target.profiles[profile];
  ensure(selected.model === (profile === 'fast' ? 'qwen2.5:1.5b' : 'qwen2.5:3b'), 'Unexpected profile model.');
  if (phase === 'run') ensure(typeof selected.digest === 'string' && /^[a-f0-9]{64}$/.test(selected.digest), 'Qualify and pin this profile before regular jobs.');
  target.model = selected.model;
  target.model_digest = selected.digest;
  ensure(['brief', 'careful'].includes(job.mode) && typeof job.prompt === 'string' && job.prompt.length > 0, 'Use a brief/careful job with a prompt and context.');
  if (phase === 'plan') {
    console.log(JSON.stringify({ phase, profile, model: target.model, contextTokens: target.context_tokens, oneJobAtATime: true, keepAlive: 0, temporaryContainer: true, backendBind: '127.0.0.1', changed: false }));
    return;
  }
  const payload = { target, job, phase, profile, nonce: randomBytes(8).toString('hex') };
  const source = String.raw`<?php
ini_set('zend.exception_ignore_args','1');
set_exception_handler(function($error){$directory='/root/.local/state/owl-red/llm-failure-'.bin2hex(random_bytes(6));mkdir($directory,0700,true);file_put_contents($directory.'/failure.log',$error->getMessage()."\n".$error->getTraceAsString());chmod($directory.'/failure.log',0600);file_put_contents('php://stderr','Private NAS diagnostics: '.$directory.PHP_EOL);exit(1);});
$request=json_decode(base64_decode('REQUEST'),true,512,JSON_THROW_ON_ERROR);$target=$request['target'];
function check($condition,$message){if(!$condition)throw new RuntimeException($message);}
function run($args){$process=proc_open($args,[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']],$pipes);fclose($pipes[0]);$output=stream_get_contents($pipes[1]);fclose($pipes[1]);$error=stream_get_contents($pipes[2]);fclose($pipes[2]);$code=proc_close($process);check($code===0,'Worker command failed: '.($args[0]??'unknown').' '.$error);return trim(($args[1]??'')==='logs'?$output.$error:$output);}
function memoryUsed(){return (int)run(['nvidia-smi','--query-gpu=memory.used','--format=csv,noheader,nounits']);}
$lock=fopen('/var/run/owl-red-llm.lock','c');check(flock($lock,LOCK_EX|LOCK_NB),'Another LLM job is already running');
check(trim(run(['docker','ps','-a','--filter','name=^/ollama$','--format','{{.Names}}']))==='','Diagnostic-only worker: persistent Ollama is present; use the authenticated service instead');
check(trim(run(['findmnt','-n','-o','TARGET','--target','/mnt/ssd']))==='/mnt/ssd','Model SSD is not mounted');
$base=$target['model_directory'];if(file_exists($base))check(is_dir($base)&&!is_link($base)&&is_file($base.'/.owl-red-llm'),'Unmanaged model directory; adoption refused');
if(!is_dir($base)){check(disk_free_space('/mnt/ssd')>20*1073741824,'Insufficient model SSD headroom');mkdir($base,0700,true);file_put_contents($base.'/.owl-red-llm','llm-models');}
$connection=@fsockopen('127.0.0.1',$target['localhost_port'],$code,$message,1);check($connection===false,'Worker localhost port is already in use');
$free=(int)run(['nvidia-smi','--query-gpu=memory.free','--format=csv,noheader,nounits']);check($free>=$target['minimum_free_vram_mib'],'GPU is busy; queue or retry later');
$before=memoryUsed();$peak=$before;$name='owl-llm-job-'.$request['nonce'];$started=false;$jobStarted=microtime(true);
function metrics($result){$duration=$result['eval_duration']??0;$tokens=$result['eval_count']??0;check($duration>0&&$tokens>0,'Inference timing metrics are missing');return ['outputTokens'=>$tokens,'generationSeconds'=>round($duration/1e9,3),'tokensPerSecond'=>round($tokens*1e9/$duration,2),'promptTokens'=>$result['prompt_eval_count']??null,'loadSeconds'=>round(($result['load_duration']??0)/1e9,3)];}
function api($route,$data=null,$track=false){
 global $target,$peak;
 $handle=curl_init('http://127.0.0.1:'.$target['localhost_port'].$route);curl_setopt_array($handle,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>600]);
 if($data!==null){curl_setopt($handle,CURLOPT_POST,true);curl_setopt($handle,CURLOPT_HTTPHEADER,['Content-Type: application/json']);curl_setopt($handle,CURLOPT_POSTFIELDS,json_encode($data));}
 if($track){$last=0;curl_setopt($handle,CURLOPT_NOPROGRESS,false);curl_setopt($handle,CURLOPT_XFERINFOFUNCTION,function()use(&$last){global $peak;if(time()>$last){$peak=max($peak,memoryUsed());$last=time();}return 0;});}
 $body=curl_exec($handle);$status=curl_getinfo($handle,CURLINFO_HTTP_CODE);curl_close($handle);check($body!==false&&$status===200,'Private inference API failed');return json_decode($body,true,512,JSON_THROW_ON_ERROR);
}
try{
 run(['docker','run','-d','--name',$name,'--restart','no','--label','owl.red.component=llm-ephemeral','--runtime','nvidia','--gpus','all','--cpus',(string)$target['cpus'],'--memory',$target['memory_limit_mib'].'m','--security-opt','no-new-privileges:true','--cap-drop','ALL','--log-opt','max-size=10m','--log-opt','max-file=2','-e','OLLAMA_KEEP_ALIVE=0','-e','OLLAMA_NUM_PARALLEL=1','-e','OLLAMA_MAX_LOADED_MODELS=1','-e','OLLAMA_CONTEXT_LENGTH=4096','-e','OLLAMA_NO_CLOUD=1','-v',$base.':/root/.ollama','-p','127.0.0.1:'.$target['localhost_port'].':11434',$target['image']]);$started=true;
 run(['curl','--fail','--silent','--show-error','--retry','8','--retry-all-errors','--retry-connrefused','--retry-delay','1','--retry-max-time','60','--max-time','10','http://127.0.0.1:'.$target['localhost_port'].'/api/version']);
 if($request['phase']==='qualify')api('/api/pull',['model'=>$target['model'],'stream'=>false]);
 $models=api('/api/tags')['models'];$matching=array_values(array_filter($models,fn($model)=>$model['name']===$target['model']));check(count($matching)===1,'Fixed model is missing');$digest=$matching[0]['digest'];
 if(isset($target['model_digest']))check($digest===$target['model_digest'],'Model digest changed; requalification required');
 $mode=$target['modes'][$request['job']['mode']];$facts=json_encode($request['job']['context']??null);$prompt=$request['job']['prompt']."\nProvided facts: ".$facts;
 $result=api('/api/generate',['model'=>$target['model'],'prompt'=>$prompt,'stream'=>false,'keep_alive'=>0,'options'=>['num_ctx'=>$target['context_tokens'],'num_predict'=>$mode['output_tokens'],'temperature'=>0.1]],true);
 $passes=[metrics($result)];
 if($mode['passes']===2){$result=api('/api/generate',['model'=>$target['model'],'prompt'=>'Check the draft against the supplied facts. Return only a corrected concise summary, with no invented facts. Facts: '.$facts."\nDraft: ".$result['response'],'stream'=>false,'keep_alive'=>0,'options'=>['num_ctx'=>$target['context_tokens'],'num_predict'=>$mode['output_tokens'],'temperature'=>0.1]],true);$passes[]=metrics($result);}
 $loaded=count(api('/api/ps')['models']??[]);check($loaded===0,'Model remained loaded after keep_alive zero');
 $answer=['profile'=>$request['profile'],'model'=>$target['model'],'modelDigest'=>$digest,'mode'=>$request['job']['mode'],'response'=>$result['response'],'outputTokens'=>$result['eval_count']??null,'passes'=>$passes,'totalOutputTokens'=>array_sum(array_column($passes,'outputTokens')),'vramBeforeMiB'=>$before,'vramPeakMiB'=>$peak,'loadedModelsAfterResponse'=>$loaded];
}catch(Throwable $error){if($started){$directory='/root/.local/state/owl-red/llm-worker-'.bin2hex(random_bytes(6));mkdir($directory,0700,true);file_put_contents($directory.'/startup.log',run(['docker','logs',$name]));chmod($directory.'/startup.log',0600);throw new RuntimeException($error->getMessage().' Private worker startup: '.$directory);}throw $error;
}finally{if($started)run(['docker','rm','-f',$name]);flock($lock,LOCK_UN);fclose($lock);}
$after=memoryUsed();$answer['jobSeconds']=round(microtime(true)-$jobStarted,3);$answer['vramAfterContainerExitMiB']=$after;$answer['temporaryContainerRemoved']=true;$answer['gpuUsed']=$peak>$before+256;$answer['returnedToBaseline']=$after<=$before+32;
check($answer['gpuUsed'],'GPU offload was not demonstrated; CPU fallback is not accepted as GPU qualification');check($answer['returnedToBaseline'],'GPU memory did not return to baseline');
echo json_encode($answer,JSON_PRETTY_PRINT).PHP_EOL;
`;
  const result = spawnSync('ssh', ['-T', '-i', path.join(home, '.ssh/id_ed25519_owl_ansible'), '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', 'root@' + target.host, 'php'], { input: source.replace('REQUEST', Buffer.from(JSON.stringify(payload)).toString('base64')), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) {
    const directory = fs.mkdtempSync(path.join(home, '.local/state/owl-red/llm-'));
    fs.writeFileSync(path.join(directory, 'failure.log'), (result.stdout || '') + (result.stderr || ''), { mode: 0o600 });
    throw new Error('LLM qualification/job failed; private diagnostics: ' + directory);
  }
  console.log(result.stdout.trim());
}
try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }