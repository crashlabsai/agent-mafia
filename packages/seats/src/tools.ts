import type { ToolSchema } from './providers/provider.ts'

/**
 * The one tool a seat has. Calling it ends the wake.
 *
 * The schema is deliberately **fixed for the whole game**, listing every action
 * type rather than only the ones legal right now. Tools render ahead of the
 * messages in the cached prefix, so a schema that changed per phase would
 * invalidate the cache on every turn — and a seat is one continuous session
 * across a whole game, where that cost compounds. Which subset is legal this
 * turn is stated in the briefing text instead, and the engine is the actual
 * authority: an illegal action is rejected and costs the seat its turn.
 */
export const SUBMIT_ACTION: ToolSchema = {
  name: 'submit_action',
  description:
    'Take your action for this turn. Calling this ends your turn. ' +
    'Only the actions listed as available in the briefing will be accepted.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'speak',
          'pass',
          'mafia_chat',
          'vote',
          'night_kill',
          'night_protect',
          'night_investigate',
          'no_action',
        ],
        description: 'Which action to take.',
      },
      target: {
        type: 'string',
        description:
          'Seat id to target, for vote and the night actions — the "seat-N" ' +
          'form shown next to each name in the briefing, not the name and not ' +
          'a bare number. Omit to abstain when voting.',
      },
      message: {
        type: 'string',
        description:
          'What to say, for speak and mafia_chat. HARD LIMIT 1000 characters — ' +
          'a longer message is rejected outright and costs you your turn, so ' +
          'count before you send and cut whole arguments rather than trimming words.',
      },
    },
    required: ['action'],
  },
}

export const SEAT_TOOLS: ToolSchema[] = [SUBMIT_ACTION]
