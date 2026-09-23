import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { spawn } from 'node:child_process';
import type { ConversationTurn } from '../adapters/aiAdapter.ts';
import type { JJum } from '../types/jjum.ts';

export interface DecisionScore {
  jjumId: string;
  score: number;
  confidence: number;
}

export interface RecallDecisionEngine {
  scoreRecallCandidates(
    context: ConversationTurn[],
    candidates: JJum[],
  ): Promise<DecisionScore[]>;
}

export interface LayaDecisionEngineOptions {
  pythonCommand?: string;
  enginePath?: string;
  storageRoot?: string; // 사용자 저장소 경로
  minConfidence?: number;
  timeoutMs?: number;
}

const BRIDGE = `
import json
import sys
from laya import Router

request = json.load(sys.stdin)
router = Router(preload=False, max_loaded=1)
questions = {}
for candidate in request["candidates"]:
    questions[candidate["jjumId"]] = {
        "type": "score",
        "instructions": "현재 대화에서 이 기억을 회상할 관련성과 유용성을 평가하세요.",
        "criteria": ["무관함", "약간 관련", "관련 있음", "매우 관련 있고 지금 필요함"],
    }
result = router.predict(request["state"], questions)
answers = result["answers"]
json.dump({
    "scores": [
        {
            "jjumId": candidate["jjumId"],
            "score": max(0.0, min(1.0, answers[candidate["jjumId"]]["score"] / 3.0)),
            "confidence": answers[candidate["jjumId"]]["confidence"],
        }
        for candidate in request["candidates"]
    ]
}, sys.stdout)
`;

const HIDDEN_SYSTEM_FOLDER = '.🫀해마_심층_중추신경계🫀';
const ENGINES_FOLDER = 'engines';

function defaultEnginePath(storageRoot?: string): string {
  if (storageRoot) {
    // 사용자 저장소 내부 경로: {storageRoot}/🧠장기기억저장소_feat.해마🧠/.🫀해마_심층_중추신경계🫀/engines/laya
    const hiddenSystemPath = join(storageRoot, '🧠장기기억저장소_feat.해마🧠', HIDDEN_SYSTEM_FOLDER);
    const userEnginePath = join(hiddenSystemPath, ENGINES_FOLDER, 'laya');
    if (existsSync(userEnginePath)) {
      return userEnginePath;
    }
  }
  // 개발 프로젝트 경로: {cwd}/engines/laya
  return join(process.cwd(), 'engines', 'laya');
}

function defaultPythonCommand(enginePath: string) {
  const venvPython = join(enginePath, '.venv', 'bin', 'python');
  return existsSync(venvPython) ? venvPython : 'python3';
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}

export class LayaDecisionEngine implements RecallDecisionEngine {
  private readonly pythonCommand: string;
  private readonly enginePath: string;
  private readonly minConfidence: number;
  private readonly timeoutMs: number;

  constructor(options: LayaDecisionEngineOptions = {}) {
    this.enginePath = options.enginePath || defaultEnginePath(options.storageRoot);
    this.pythonCommand = options.pythonCommand || defaultPythonCommand(this.enginePath);
    this.minConfidence = clamp(options.minConfidence ?? 0.7);
    this.timeoutMs = Math.max(1000, options.timeoutMs ?? 30000);
  }

  async scoreRecallCandidates(
    context: ConversationTurn[],
    candidates: JJum[],
  ): Promise<DecisionScore[]> {
    if (candidates.length === 0) return [];
    const payload = JSON.stringify({
      state: context,
      candidates: candidates.map((jjum) => ({
        jjumId: jjum.jjumId,
        jjumName: jjum.jjumName,
        aliases: jjum.aliases,
        summary: jjum.summary,
        facts: jjum.facts.map((fact) => fact.text),
        tags: jjum.tags,
      })),
    });

    const raw = await this.runBridge(payload);
    const scores = Array.isArray(raw?.scores) ? raw.scores : [];
    return scores
      .filter((item): item is DecisionScore =>
        item &&
        typeof item.jjumId === 'string' &&
        Number.isFinite(item.score) &&
        Number.isFinite(item.confidence) &&
        item.confidence >= this.minConfidence,
      )
      .map((item) => ({
        jjumId: item.jjumId,
        score: clamp(item.score),
        confidence: clamp(item.confidence),
      }));
  }

  private runBridge(payload: string): Promise<{ scores?: DecisionScore[] }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.pythonCommand, ['-c', BRIDGE], {
        cwd: this.enginePath,
        env: {
          ...process.env,
          PYTHONPATH: [this.enginePath, process.env.PYTHONPATH].filter(Boolean).join(delimiter),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        child.kill();
        reject(new Error(`Laya decision timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      child.on('error', (error) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(error);
        }
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (code !== 0) {
          reject(new Error(`Laya exited with code ${code}: ${stderr.trim()}`));
          return;
        }
        try {
          resolve(JSON.parse(stdout) as { scores?: DecisionScore[] });
        } catch {
          reject(new Error(`Laya returned invalid JSON: ${stdout.slice(0, 200)}`));
        }
      });
      child.stdin.end(payload);
    });
  }
}
