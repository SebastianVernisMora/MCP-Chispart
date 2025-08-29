<?php
// API sencilla para leer/escribir estado del MCP.
// Nota: las acciones invocan el orquestador vía shell y requieren Node en PATH.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$root = realpath(__DIR__ . '/..');
$stateRoot = $root . DIRECTORY_SEPARATOR . '.mcp' . DIRECTORY_SEPARATOR . 'state';
$tasksFile = $stateRoot . DIRECTORY_SEPARATOR . 'tasks.json';
$timelineFile = $stateRoot . DIRECTORY_SEPARATOR . 'timeline.jsonl';
$wrapper = $root . DIRECTORY_SEPARATOR . 'chispart_mcp.sh';

function out($data, $code = 200) {
  http_response_code($code);
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
  exit;
}

function safeStr($s) { return is_string($s) ? trim($s) : ''; }

function run_wrapper($args) {
  global $root, $wrapper;
  $cmd = 'cd ' . escapeshellarg($root) . ' && bash ' . escapeshellarg($wrapper) . ' ' . $args . ' 2>&1';
  $lines = [];
  $code = 0;
  @exec($cmd, $lines, $code);
  return [ 'ok' => $code === 0, 'code' => $code, 'output' => implode("\n", $lines) ];
}

$action = isset($_GET['action']) ? $_GET['action'] : 'tasks';

if ($action === 'tasks') {
  if (!file_exists($tasksFile)) out([ 'tasks' => [] ]);
  $json = json_decode(file_get_contents($tasksFile), true);
  out($json ?: [ 'tasks' => [] ]);
}

if ($action === 'timeline') {
  $since = isset($_GET['since']) ? safeStr($_GET['since']) : '';
  if (!file_exists($timelineFile)) out([]);
  $lines = array_filter(explode("\n", trim(file_get_contents($timelineFile))));
  $events = [];
  foreach (array_slice($lines, -300) as $line) {
    $j = json_decode($line, true);
    if (!$j) continue;
    if (!$since || (isset($j['ts']) && $j['ts'] > $since)) $events[] = $j;
  }
  out($events);
}

if ($action === 'taskShow') {
  $id = isset($_GET['id']) ? safeStr($_GET['id']) : '';
  if (!$id) out([ 'error' => 'Falta id' ], 400);
  $res = run_wrapper('tasks show ' . escapeshellarg($id));
  $json = json_decode($res['output'] ?? '', true);
  out([ 'ok' => $res['ok'], 'task' => $json ?: null, 'raw' => $res['output'] ], $res['ok'] ? 200 : 500);
}

// Acciones que requieren shell
if (!is_executable($wrapper)) {
  // permitir aunque no sea ejecutable (se invocará con bash)
}

if ($action === 'pump') {
  $res = run_wrapper('pump');
  out($res, $res['ok'] ? 200 : 500);
}

if ($action === 'createTask') {
  $title = isset($_GET['title']) ? safeStr($_GET['title']) : '';
  $repo = isset($_GET['repo']) ? safeStr($_GET['repo']) : '';
  if (!$title || !$repo) out([ 'error' => 'Faltan title y repo' ], 400);
  $res = run_wrapper('task ' . escapeshellarg($title) . ' ' . escapeshellarg($repo));
  out($res, $res['ok'] ? 200 : 500);
}

if ($action === 'closeTask') {
  $id = isset($_GET['id']) ? safeStr($_GET['id']) : '';
  $status = isset($_GET['status']) ? safeStr($_GET['status']) : 'done';
  if (!$id) out([ 'error' => 'Falta id' ], 400);
  $res = run_wrapper('tasks close ' . escapeshellarg($id) . ' --status ' . escapeshellarg($status));
  out($res, $res['ok'] ? 200 : 500);
}

if ($action === 'sendChange') {
  $title = isset($_GET['title']) ? safeStr($_GET['title']) : '';
  $repo = isset($_GET['repo']) ? safeStr($_GET['repo']) : '';
  $roles = isset($_GET['roles']) ? safeStr($_GET['roles']) : '';
  $payload = isset($_GET['payload']) ? $_GET['payload'] : '';
  $prefix = isset($_GET['prefix']) ? $_GET['prefix'] : '';
  $suffix = isset($_GET['suffix']) ? $_GET['suffix'] : '';
  if (!$repo || (!$title && !$payload)) out([ 'error' => 'Faltan repo y título o payload' ], 400);
  $args = 'send change ' . escapeshellarg($title ?: 'Change Request') . ' --repo ' . escapeshellarg($repo);
  if ($roles) $args .= ' --roles ' . escapeshellarg($roles);
  if ($payload) $args .= ' --payload ' . escapeshellarg($payload);
  if ($prefix) $args .= ' --prefix ' . escapeshellarg($prefix);
  if ($suffix) $args .= ' --suffix ' . escapeshellarg($suffix);
  $res = run_wrapper($args);
  out($res, $res['ok'] ? 200 : 500);
}

if ($action === 'tasksReport') {
  $id = isset($_GET['id']) ? safeStr($_GET['id']) : '';
  if (!$id) out([ 'error' => 'Falta id' ], 400);
  $res = run_wrapper('tasks report ' . escapeshellarg($id));
  $json = json_decode($res['output'] ?? '', true);
  out([ 'ok' => $res['ok'], 'summary' => $json ?: null, 'raw' => $res['output'] ], $res['ok'] ? 200 : 500);
}

if ($action === 'tasksPlan') {
  $id = isset($_GET['id']) ? safeStr($_GET['id']) : '';
  if (!$id) out([ 'error' => 'Falta id' ], 400);
  $res = run_wrapper('tasks plan ' . escapeshellarg($id));
  $json = json_decode($res['output'] ?? '', true);
  out([ 'ok' => $res['ok'], 'plan' => $json ?: null, 'raw' => $res['output'] ], $res['ok'] ? 200 : 500);
}

if ($action === 'nlExec') {
  $text = isset($_GET['text']) ? safeStr($_GET['text']) : '';
  $repo = isset($_GET['repo']) ? safeStr($_GET['repo']) : '';
  $roles = isset($_GET['roles']) ? safeStr($_GET['roles']) : '';
  if (!$text) out([ 'error' => 'Falta text' ], 400);
  $args = 'nl exec ' . escapeshellarg($text);
  if ($repo) $args .= ' --repo ' . escapeshellarg($repo);
  if ($roles) $args .= ' --roles ' . escapeshellarg($roles);
  $res = run_wrapper($args);
  $json = json_decode($res['output'] ?? '', true);
  out([ 'ok' => $res['ok'], 'result' => $json ?: null, 'raw' => $res['output'] ], $res['ok'] ? 200 : 500);
}

out([ 'error' => 'Acción no soportada' ], 400);
