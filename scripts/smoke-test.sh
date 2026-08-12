#!/bin/bash
# Kanban Web API 冒烟测试 — 用法: KANBAN_WEB_USER/PASS/BASE 可覆盖，默认本机 9120
# 覆盖: 认证 / 看板 / 任务全生命周期 / boards / 任务补全 / 全局接口
B="${BASE:-http://127.0.0.1:9120}"
U="${KANBAN_WEB_USER:-hermes}"
P="${KANBAN_WEB_PASS:?set KANBAN_WEB_PASS}"
A="-u $U:$P -H Content-Type:application/json"
PASS=0; FAIL=0
t() { # t <name> <expected_code> <curl args...>
  local name="$1" exp="$2"; shift 2
  local code=$(curl -s -o /tmp/kw.out -w "%{http_code}" $A "$@")
  if [ "$code" = "$exp" ]; then PASS=$((PASS+1)); echo "PASS $name ($code)"; else FAIL=$((FAIL+1)); echo "FAIL $name got $code want $exp"; head -c 200 /tmp/kw.out; echo; fi
}
echo "=== v1 回归 ==="
# 真实无认证请求（不带 -u），应 401
NA=$(curl -s -o /dev/null -w "%{http_code}" $B/api/board)
if [ "$NA" = "401" ]; then PASS=$((PASS+1)); echo "PASS noauth 401 ($NA)"; else FAIL=$((FAIL+1)); echo "FAIL noauth got $NA want 401"; fi
t "board" 200 $B/api/board
t "tasks" 200 "$B/api/tasks?status=todo"
t "stats" 200 $B/api/stats
echo "=== boards ==="
t "boards list" 200 $B/api/boards
t "boards current" 200 $B/api/boards/current
echo "=== 任务补全 ==="
R=$(curl -s $A -X POST $B/api/tasks -d '{"title":"v2冒烟测试","body":"v2"}')
ID=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
echo "  测试任务: $ID"
[ -n "$ID" ] && [ "$ID" != "None" ] && {
  t "context" 200 $B/api/tasks/$ID/context
  t "notify list" 200 $B/api/tasks/$ID/notify
  # 顺序：先 claim（任务进入 running）再 heartbeat；log 对新任务可能「尚未 spawn」→ 400 可接受
  t "claim" 200 -X POST $B/api/tasks/$ID/claim -d '{"ttl":300}'
  t "heartbeat" 200 -X POST $B/api/tasks/$ID/heartbeat -d '{"note":"smoke"}'
  LC=$(curl -s -o /tmp/kw.out -w "%{http_code}" $A "$B/api/tasks/$ID/log?tail=500")
  if [ "$LC" = "200" ]; then PASS=$((PASS+1)); echo "PASS log (200)"; else
    if grep -q "no log" /tmp/kw.out; then echo "OK   log (400 no-log, fresh task — acceptable)"; PASS=$((PASS+1))
    else FAIL=$((FAIL+1)); echo "FAIL log got $LC want 200"; head -c 200 /tmp/kw.out; echo; fi
  fi
  t "assignees" 200 $B/api/assignees
  curl -s $A -X POST $B/api/tasks/$ID/action -d '{"action":"archive"}' > /dev/null   # 清理
}
echo "=== 全局 ==="
t "diagnostics" 200 $B/api/diagnostics
t "events since" 200 "$B/api/events?since=$(date +%s)"
t "repair" 200 -X POST $B/api/repair
echo "=== 手动触发调度器（POST /api/scheduler/run）==="
# 无权限：无凭据 / 错误凭据 → 401
NA=$(curl -s -o /dev/null -w "%{http_code}" -X POST $B/api/scheduler/run)
if [ "$NA" = "401" ]; then PASS=$((PASS+1)); echo "PASS sched noauth 401 ($NA)"; else FAIL=$((FAIL+1)); echo "FAIL sched noauth got $NA want 401"; fi
NA=$(curl -s -o /dev/null -w "%{http_code}" -u "$U:wrong-pass" -X POST $B/api/scheduler/run)
if [ "$NA" = "401" ]; then PASS=$((PASS+1)); echo "PASS sched wrong-creds 401 ($NA)"; else FAIL=$((FAIL+1)); echo "FAIL sched wrong-creds got $NA want 401"; fi
# 参数校验：max 非整数 → 400
t "sched max-nonint 400" 400 -X POST $B/api/scheduler/run -d '{"max":"abc"}'
# dry_run 预览 → 200 + 契约（status=triggered / ok / dry_run=true / result 存在）
R=$(curl -s -o /tmp/kw_sched.out -w "%{http_code}" $A -X POST $B/api/scheduler/run -d '{"dry_run":true}')
if [ "$R" = "200" ]; then
  if python3 -c "
import json
d=json.load(open('/tmp/kw_sched.out'))
assert d.get('status')=='triggered' and d.get('ok') is True and d.get('dry_run') is True and isinstance(d.get('result'),dict)
"; then PASS=$((PASS+1)); echo "PASS sched dry_run 200 + contract"; else FAIL=$((FAIL+1)); echo "FAIL sched dry_run contract"; head -c 200 /tmp/kw_sched.out; echo; fi
else FAIL=$((FAIL+1)); echo "FAIL sched dry_run got $R want 200"; head -c 200 /tmp/kw_sched.out; echo; fi
# 并发保护：board 调度锁被占 → 409（真实 flock 复现「调度器运行中再次触发」）
flock -n /root/.hermes/kanban.db.dispatch.lock -c 'sleep 5' &
FPID=$!
sleep 0.3
t "sched busy 409" 409 -X POST $B/api/scheduler/run
wait $FPID
# 锁释放后恢复 → dry_run 200
t "sched recovery 200" 200 -X POST $B/api/scheduler/run -d '{"dry_run":true}'
echo "=== swarm（慢，可注释）==="
t "swarm" 200 -X POST $B/api/swarm -d '{"goal":"冒烟测试目标","workers":[{"profile":"default","title":"worker1"}],"verifier":"default","synthesizer":"default"}'
echo
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ] && echo "ALL OK" || echo "HAS FAILURES"
