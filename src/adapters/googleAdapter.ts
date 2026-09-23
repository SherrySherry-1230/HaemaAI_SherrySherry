// @editedBy SherrySherry 2026-09-24
/**
 * Google 어댑터 구현
 * Google Generative AI SDK를 사용하여 Gemini 시리즈를 호출한다.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
  AIAdapter,
  AIAdapterConfig,
  ConversationTurn,
  ExtractedDraft,
  ExtractRequest,
  MergeJudgement,
  RecallScore,
} from './aiAdapter.ts';
import type { JJum, JJumId } from '../types/jjum.ts';

export class GoogleAdapter implements AIAdapter {
  readonly config: AIAdapterConfig;
  private client!: GoogleGenerativeAI;

  constructor(config: AIAdapterConfig) {
    this.config = config;

    if (!config.apiKey) {
      throw new Error('GoogleAdapter requires apiKey in config');
    }

    this.client = new GoogleGenerativeAI(config.apiKey);
  }

  private getModelForTask(task: string): string {
    return this.config.taskModels?.[task as keyof typeof this.config.taskModels] || this.config.model;
  }

  private async callAI(task: string, system: string, user: string): Promise<string> {
    const model = this.getModelForTask(task);

    try {
      const modelInstance = this.client.getGenerativeModel({
        model,
        systemInstruction: system,
      });

      const result = await modelInstance.generateContent(user);
      const content = result.response.text();
      if (!content) {
        throw new Error('AI returned empty response');
      }

      return content;
    } catch (error) {
      throw new Error(`AI call failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async extractJJums(req: ExtractRequest): Promise<ExtractedDraft[]> {
    const turnsText = req.turns
      .map((t) => `${t.role}: ${t.text}`)
      .join('\n');

    const knownNamesText = req.knownNames?.join(', ') || '없음';
    const hint = req.hint ? `\n\n추가 지시: ${req.hint}` : '';

    const system = `당신은 대화에서 기억할 만한 정보(사람, 장소, 사건 등)를 추출하는 AI입니다.
대화 내용을 분석하여 점(JJum)(기억 단위)를 추출하세요.

출력 형식(JSON):
[
  {
    "jjumName": "대표 명칭",
    "type": "유형(예: person, place, event, etc)",
    "aliases": ["별칭1", "별칭2"],
    "tags": ["태그1", "태그2"],
    "factTexts": ["사실1", "사실2"],
    "eventSummary": "사건 요약(해당 시)",
    "relatedNames": ["관련 이름1", "관련 이름2"]
  }
]

규칙:
- 근거 없는 내용은 만들지 마세요(기억 지어내기 금지)
- 이미 알고 있는 이름(knownNames)에도 새로운 사실이나 변화가 있으면 같은 이름 또는 별칭으로 초안을 내세요
- 같은 대상을 한 응답에서 여러 초안으로 중복 출력하지 마세요
- 사건은 하나의 사건으로 요약하세요
- 함께 등장한 이름은 relatedNames에 포함하세요`;

    const user = `대화 내용:
${turnsText}

이미 알고 있는 이름: ${knownNamesText}
${hint}

쩜(JJum)을 추출하세요.`;

    const response = await this.callAI('extract', system, user);

    try {
      const parsed = JSON.parse(response);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new Error('Failed to parse AI response as JSON');
    }
  }

  async summarizeJJum(jjum: JJum, hint?: string): Promise<{ summary: string }> {
    const hintText = hint ? `\n\n추가 지시: ${hint}` : '';

    const system = `당신은 점(JJum)의 요약을 생성하는 AI입니다.
점(JJum)의 정보를 바탕으로 간결한 요약을 작성하세요.
요약에는 해당 점의 핵심 정보와 관계를 포함해야 합니다.`;

    const user = `점(JJum) 정보:
이름: ${jjum.jjumName}
유형: ${jjum.type}
별칭: ${jjum.aliases.join(', ')}
태그: ${jjum.jjtags.join(', ')}
사실: ${jjum.facts.map(f => f.text).join('\n')}
${jjum.summary ? `기존 요약: ${jjum.summary}` : ''}
${hintText}

요약을 작성하세요.`;

    const response = await this.callAI('summarize', system, user);

    return { summary: response };
  }

  async judgeMergeCandidate(a: JJum, b: JJum, hint?: string): Promise<MergeJudgement> {
    const hintText = hint ? `\n\n추가 지시: ${hint}` : '';

    const system = `당신은 두 점(JJum)가 같은 대상인지 판정하는 AI입니다.
0(다른 대상)~1(같은 대상) 사이의 신뢰도 점수를 매기세요.

출력 형식(JSON):
{
  "confidence": 0.0~1.0,
  "reason": "판정 이유"
}`;

    const user = `세포 A:
이름: ${a.jjumName}
유형: ${a.type}
별칭: ${a.aliases.join(', ')}
사실: ${a.facts.map(f => f.text).join('\n')}

세포 B:
이름: ${b.jjumName}
유형: ${b.type}
별칭: ${b.aliases.join(', ')}
사실: ${b.facts.map(f => f.text).join('\n')}
${hintText}

판정하세요.`;

    const response = await this.callAI('judgeMerge', system, user);

    try {
      const parsed = JSON.parse(response);
      return {
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
        reason: parsed.reason || '',
      };
    } catch {
      throw new Error('Failed to parse AI response as JSON');
    }
  }

  async scoreRecallCandidates(
    context: ConversationTurn[],
    candidates: JJum[],
    hint?: string,
  ): Promise<RecallScore[]> {
    const contextText = context
      .map((t) => `${t.role}: ${t.text}`)
      .join('\n');

    const candidatesText = candidates
      .map((c) => `- ${c.jjumName} (${c.type}): ${c.summary || c.facts[0]?.text || ''}`)
      .join('\n');

    const hintText = hint ? `\n\n추가 지시: ${hint}` : '';

    const system = `당신은 현재 맥락에서 꺼낼 가치가 있는 기억을 점수화하는 AI입니다.
후보 기억들을 0(무관)~1(지금 꺼낼 가치 높음) 사이로 점수화하세요.

출력 형식(JSON):
[
  {
    "jjumId": "jjum-123",
    "score": 0.0~1.0,
    "reason": "점수 이유"
  }
]`;

    const user = `현재 대화 맥락:
${contextText}

후보 기억:
${candidatesText}
${hintText}

점수화하세요.`;

    const response = await this.callAI('scoreRecall', system, user);

    try {
      const parsed = JSON.parse(response);
      return Array.isArray(parsed)
        ? parsed.map((item: { jjumId: string; score: number; reason?: string }) => ({
            jjumId: item.jjumId as JJumId,
            score: typeof item.score === 'number' ? item.score : 0,
            reason: item.reason || '',
          }))
        : [];
    } catch {
      throw new Error('Failed to parse AI response as JSON');
    }
  }
}
