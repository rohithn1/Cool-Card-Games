import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  GameState, 
  Player, 
  Card, 
  GamePhase, 
  TurnPhase,
  PowerUpAction,
  StackAction,
  calculateScore,
  cardsMatch,
  getCardPowerUp
} from '@/types/game';
import { createDeck, shuffleDeck, dealCards, drawFromDeck, generateGameCode } from '@/lib/deck';
import { v4 as uuidv4 } from 'uuid';

interface GameStore {
  // Connection state
  peerId: string | null;
  playerName: string;
  isHost: boolean;
  
  // Game state
  game: GameState | null;
  
  // Local UI state
  selectedCardIndex: number | null;
  inspectedCard: { playerId: string; cardIndex: number; card: Card } | null;
  showingBottomCards: boolean;
  
  // Actions
  setPeerId: (id: string) => void;
  setPlayerName: (name: string) => void;
  
  // Game management
  createGame: () => string;
  joinGame: (gameCode: string) => void;
  addPlayer: (player: Player) => void;
  removePlayer: (playerId: string) => void;
  startGame: () => void;
  
  // Game actions
  viewBottomCards: () => void;
  finishViewingCards: () => void;
  drawCard: (fromDiscard: boolean) => void;
  swapCard: (cardIndex: number) => void;
  discardCard: () => void;
  
  // Power-up actions
  startPowerUp: (action: PowerUpAction) => void;
  completePowerUp: (targetPlayerId?: string, targetCardIndex?: number) => void;
  cancelPowerUp: () => void;
  
  // Stacking
  attemptStack: (playerCardIndex: number, targetPlayerId?: string, targetCardIndex?: number) => void;
  resolveStack: (winningStack: StackAction | null) => void;
  
  // End game
  callReds: () => void;
  endTurn: () => void;
  revealAllCards: () => void;
  
  // UI actions
  selectCard: (index: number | null) => void;
  setInspectedCard: (info: { playerId: string; cardIndex: number; card: Card } | null) => void;
  
  // Sync
  syncState: (state: GameState) => void;
  resetGame: () => void;
}

const initialGameState = (): GameState => ({
  gameCode: '',
  phase: 'waiting',
  turnPhase: 'draw',
  currentPlayerIndex: 0,
  players: [],
  deck: [],
  discardPile: [],
  drawnCard: null,
  currentPowerUp: null,
  pendingStacks: [],
  redsCallerId: null,
  finalRoundTurnsRemaining: 0,
  winner: null,
  lastAction: '',
});

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      peerId: null,
      playerName: '',
      isHost: false,
      game: null,
      selectedCardIndex: null,
      inspectedCard: null,
      showingBottomCards: false,

      setPeerId: (id) => set({ peerId: id }),
      setPlayerName: (name) => set({ playerName: name }),

      createGame: () => {
        const gameCode = generateGameCode();
        const { peerId, playerName } = get();
        
        const hostPlayer: Player = {
          id: peerId || uuidv4(),
          name: playerName || 'Host',
          cards: [],
          isHost: true,
          isConnected: true,
          hasSeenBottomCards: false,
          hasCalledReds: false,
        };

        set({
          isHost: true,
          game: {
            ...initialGameState(),
            gameCode,
            players: [hostPlayer],
          },
        });

        return gameCode;
      },

      joinGame: (gameCode) => {
        set({
          isHost: false,
          game: {
            ...initialGameState(),
            gameCode,
          },
        });
      },

      addPlayer: (player) => {
        const { game } = get();
        if (!game) return;

        set({
          game: {
            ...game,
            players: [...game.players, player],
            lastAction: `${player.name} joined the game`,
          },
        });
      },

      removePlayer: (playerId) => {
        const { game } = get();
        if (!game) return;

        set({
          game: {
            ...game,
            players: game.players.filter(p => p.id !== playerId),
            lastAction: 'A player left the game',
          },
        });
      },

      startGame: () => {
        const { game } = get();
        if (!game || game.players.length < 2) return;

        const deck = shuffleDeck(createDeck());
        const { playerHands, remainingDeck } = dealCards(deck, game.players.length);
        
        // Take the first card from deck for discard pile
        const [firstDiscard, ...finalDeck] = remainingDeck;

        const updatedPlayers = game.players.map((player, index) => ({
          ...player,
          cards: playerHands[index],
          hasSeenBottomCards: false,
          hasCalledReds: false,
        }));

        set({
          game: {
            ...game,
            phase: 'viewing_cards',
            turnPhase: 'draw',
            currentPlayerIndex: 0,
            players: updatedPlayers,
            deck: finalDeck,
            discardPile: [{ ...firstDiscard, faceUp: true }],
            drawnCard: null,
            currentPowerUp: null,
            pendingStacks: [],
            redsCallerId: null,
            finalRoundTurnsRemaining: 0,
            winner: null,
            lastAction: 'Game started! View your bottom 2 cards.',
          },
          showingBottomCards: true,
        });
      },

      viewBottomCards: () => {
        set({ showingBottomCards: true });
      },

      finishViewingCards: () => {
        const { game, peerId } = get();
        if (!game) return;

        const updatedPlayers = game.players.map(player => {
          if (player.id === peerId) {
            return { ...player, hasSeenBottomCards: true };
          }
          return player;
        });

        const allSeen = updatedPlayers.every(p => p.hasSeenBottomCards);

        set({
          showingBottomCards: false,
          game: {
            ...game,
            players: updatedPlayers,
            phase: allSeen ? 'playing' : 'viewing_cards',
            lastAction: allSeen ? 'All players ready. Game begins!' : game.lastAction,
          },
        });
      },

      drawCard: (fromDiscard) => {
        const { game } = get();
        if (!game || game.turnPhase !== 'draw') return;

        if (fromDiscard) {
          if (game.discardPile.length === 0) return;
          const [card, ...remainingPile] = game.discardPile;
          
          set({
            game: {
              ...game,
              drawnCard: { ...card, faceUp: true },
              discardPile: remainingPile,
              turnPhase: 'decide',
              lastAction: `Drew from discard pile`,
            },
          });
        } else {
          if (game.deck.length === 0) {
            // Reshuffle discard pile if deck is empty
            const newDeck = shuffleDeck(game.discardPile.slice(1).map(c => ({ ...c, faceUp: false })));
            const [card, ...remainingDeck] = newDeck;
            
            set({
              game: {
                ...game,
                drawnCard: { ...card, faceUp: true },
                deck: remainingDeck,
                discardPile: [game.discardPile[0]],
                turnPhase: 'decide',
                lastAction: 'Drew from deck (reshuffled)',
              },
            });
          } else {
            const { card, remainingDeck } = drawFromDeck(game.deck);
            if (!card) return;
            
            set({
              game: {
                ...game,
                drawnCard: card,
                deck: remainingDeck,
                turnPhase: 'decide',
                lastAction: 'Drew from deck',
              },
            });
          }
        }
      },

      swapCard: (cardIndex) => {
        const { game, peerId } = get();
        if (!game || !game.drawnCard || game.turnPhase !== 'decide') return;

        const currentPlayer = game.players[game.currentPlayerIndex];
        if (currentPlayer.id !== peerId) return;

        const oldCard = currentPlayer.cards[cardIndex];
        const newCards = [...currentPlayer.cards];
        newCards[cardIndex] = { ...game.drawnCard, faceUp: false };

        const updatedPlayers = game.players.map((player, idx) => {
          if (idx === game.currentPlayerIndex) {
            return { ...player, cards: newCards };
          }
          return player;
        });

        set({
          game: {
            ...game,
            players: updatedPlayers,
            discardPile: [{ ...oldCard, faceUp: true }, ...game.discardPile],
            drawnCard: null,
            turnPhase: 'draw',
            lastAction: `Swapped a card`,
          },
          selectedCardIndex: null,
        });

        // Auto end turn after swap
        get().endTurn();
      },

      discardCard: () => {
        const { game, peerId } = get();
        if (!game || !game.drawnCard || game.turnPhase !== 'decide') return;

        const currentPlayer = game.players[game.currentPlayerIndex];
        if (currentPlayer.id !== peerId) return;

        const powerUp = getCardPowerUp(game.drawnCard);

        if (powerUp) {
          // Start power-up action
          set({
            game: {
              ...game,
              discardPile: [{ ...game.drawnCard, faceUp: true }, ...game.discardPile],
              drawnCard: null,
              turnPhase: 'power_up',
              currentPowerUp: {
                type: powerUp,
                sourcePlayerId: peerId!,
              },
              lastAction: `Played a ${game.drawnCard.rank} - ${getPowerUpDescription(powerUp)}`,
            },
          });
        } else {
          // Regular discard
          set({
            game: {
              ...game,
              discardPile: [{ ...game.drawnCard, faceUp: true }, ...game.discardPile],
              drawnCard: null,
              turnPhase: 'draw',
              lastAction: `Discarded a ${game.drawnCard.rank}`,
            },
          });
          
          // Auto end turn after discard
          get().endTurn();
        }
      },

      startPowerUp: (action) => {
        const { game } = get();
        if (!game) return;

        set({
          game: {
            ...game,
            currentPowerUp: action,
            turnPhase: 'power_up',
          },
        });
      },

      completePowerUp: (targetPlayerId, targetCardIndex) => {
        const { game, peerId } = get();
        if (!game || !game.currentPowerUp) return;

        const { type, sourceCardIndex } = game.currentPowerUp;
        let updatedPlayers = [...game.players];
        let lastAction = '';

        switch (type) {
          case 'inspect_own':
            // Player inspects their own card - UI handles this
            lastAction = 'Inspected own card';
            break;

          case 'inspect_other':
            // Player inspects another player's card - UI handles this
            lastAction = 'Inspected another player\'s card';
            break;

          case 'blind_swap':
            // Blindly swap cards
            if (targetPlayerId && targetCardIndex !== undefined && sourceCardIndex !== undefined) {
              const sourcePlayerIdx = updatedPlayers.findIndex(p => p.id === peerId);
              const targetPlayerIdx = updatedPlayers.findIndex(p => p.id === targetPlayerId);
              
              if (sourcePlayerIdx !== -1 && targetPlayerIdx !== -1) {
                const temp = updatedPlayers[sourcePlayerIdx].cards[sourceCardIndex];
                updatedPlayers[sourcePlayerIdx].cards[sourceCardIndex] = 
                  updatedPlayers[targetPlayerIdx].cards[targetCardIndex];
                updatedPlayers[targetPlayerIdx].cards[targetCardIndex] = temp;
                lastAction = 'Blindly swapped cards';
              }
            }
            break;

          case 'inspect_swap':
            // Inspect and optionally swap
            if (targetPlayerId && targetCardIndex !== undefined && sourceCardIndex !== undefined) {
              const sourcePlayerIdx = updatedPlayers.findIndex(p => p.id === peerId);
              const targetPlayerIdx = updatedPlayers.findIndex(p => p.id === targetPlayerId);
              
              if (sourcePlayerIdx !== -1 && targetPlayerIdx !== -1) {
                const temp = updatedPlayers[sourcePlayerIdx].cards[sourceCardIndex];
                updatedPlayers[sourcePlayerIdx].cards[sourceCardIndex] = 
                  updatedPlayers[targetPlayerIdx].cards[targetCardIndex];
                updatedPlayers[targetPlayerIdx].cards[targetCardIndex] = temp;
                lastAction = 'Inspected and swapped cards';
              }
            } else {
              lastAction = 'Inspected but did not swap';
            }
            break;
        }

        set({
          game: {
            ...game,
            players: updatedPlayers,
            currentPowerUp: null,
            turnPhase: 'draw',
            lastAction,
          },
          inspectedCard: null,
          selectedCardIndex: null,
        });

        get().endTurn();
      },

      cancelPowerUp: () => {
        const { game } = get();
        if (!game) return;

        set({
          game: {
            ...game,
            currentPowerUp: null,
            turnPhase: 'draw',
          },
          inspectedCard: null,
          selectedCardIndex: null,
        });

        get().endTurn();
      },

      attemptStack: (playerCardIndex, targetPlayerId, targetCardIndex) => {
        const { game, peerId } = get();
        if (!game || game.discardPile.length === 0) return;

        const topDiscard = game.discardPile[0];
        const currentPlayer = game.players.find(p => p.id === peerId);
        if (!currentPlayer) return;

        // Determine which card is being stacked
        let stackCard: Card;
        if (targetPlayerId && targetCardIndex !== undefined) {
          const targetPlayer = game.players.find(p => p.id === targetPlayerId);
          if (!targetPlayer) return;
          stackCard = targetPlayer.cards[targetCardIndex];
        } else {
          stackCard = currentPlayer.cards[playerCardIndex];
        }

        const stackAction: StackAction = {
          playerId: peerId!,
          playerCardIndex,
          targetPlayerId,
          targetCardIndex,
          timestamp: Date.now(),
        };

        // Check if cards match
        if (cardsMatch(stackCard, topDiscard)) {
          // Successful stack
          let updatedPlayers = [...game.players];
          const playerIdx = updatedPlayers.findIndex(p => p.id === peerId);
          
          if (targetPlayerId && targetCardIndex !== undefined) {
            // Stacking another player's card
            const targetPlayerIdx = updatedPlayers.findIndex(p => p.id === targetPlayerId);
            
            // Move target's card to discard
            const targetCard = updatedPlayers[targetPlayerIdx].cards[targetCardIndex];
            updatedPlayers[targetPlayerIdx].cards = updatedPlayers[targetPlayerIdx].cards.filter((_, i) => i !== targetCardIndex);
            
            // Transfer one of your cards to target player
            const transferCard = updatedPlayers[playerIdx].cards[playerCardIndex];
            updatedPlayers[playerIdx].cards = updatedPlayers[playerIdx].cards.filter((_, i) => i !== playerCardIndex);
            updatedPlayers[targetPlayerIdx].cards.push(transferCard);
            
            set({
              game: {
                ...game,
                players: updatedPlayers,
                discardPile: [{ ...targetCard, faceUp: true }, ...game.discardPile],
                lastAction: `Stacked opponent's card!`,
              },
              selectedCardIndex: null,
            });
          } else {
            // Stacking your own card
            const stackedCard = updatedPlayers[playerIdx].cards[playerCardIndex];
            updatedPlayers[playerIdx].cards = updatedPlayers[playerIdx].cards.filter((_, i) => i !== playerCardIndex);
            
            set({
              game: {
                ...game,
                players: updatedPlayers,
                discardPile: [{ ...stackedCard, faceUp: true }, ...game.discardPile],
                lastAction: 'Successfully stacked a card!',
              },
              selectedCardIndex: null,
            });
          }
        } else {
          // Misstack penalty - draw an extra card
          if (game.deck.length > 0) {
            const { card: penaltyCard, remainingDeck } = drawFromDeck(game.deck);
            if (penaltyCard) {
              let updatedPlayers = [...game.players];
              const playerIdx = updatedPlayers.findIndex(p => p.id === peerId);
              updatedPlayers[playerIdx].cards.push({ ...penaltyCard, faceUp: false });
              
              set({
                game: {
                  ...game,
                  players: updatedPlayers,
                  deck: remainingDeck,
                  lastAction: 'MISSTACK! Drew a penalty card.',
                },
                selectedCardIndex: null,
              });
            }
          }
        }
      },

      resolveStack: (winningStack) => {
        const { game } = get();
        if (!game) return;

        set({
          game: {
            ...game,
            pendingStacks: [],
          },
        });
      },

      callReds: () => {
        const { game, peerId } = get();
        if (!game || game.phase !== 'playing') return;

        const currentPlayer = game.players[game.currentPlayerIndex];
        if (currentPlayer.id !== peerId) return;

        const updatedPlayers = game.players.map(player => {
          if (player.id === peerId) {
            return { ...player, hasCalledReds: true };
          }
          return player;
        });

        set({
          game: {
            ...game,
            phase: 'final_round',
            redsCallerId: peerId!,
            finalRoundTurnsRemaining: game.players.length - 1,
            players: updatedPlayers,
            lastAction: `${currentPlayer.name} called REDS! Final round begins.`,
          },
        });

        get().endTurn();
      },

      endTurn: () => {
        const { game } = get();
        if (!game) return;

        let nextPhase = game.phase;
        let turnsRemaining = game.finalRoundTurnsRemaining;
        
        if (game.phase === 'final_round') {
          turnsRemaining--;
          if (turnsRemaining <= 0) {
            nextPhase = 'game_over';
          }
        }

        const nextPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
        
        // Skip the player who called reds in final round
        let finalNextIndex = nextPlayerIndex;
        if (game.phase === 'final_round' && game.players[nextPlayerIndex].id === game.redsCallerId) {
          finalNextIndex = (nextPlayerIndex + 1) % game.players.length;
        }

        set({
          game: {
            ...game,
            currentPlayerIndex: finalNextIndex,
            turnPhase: 'draw',
            phase: nextPhase,
            finalRoundTurnsRemaining: turnsRemaining,
            drawnCard: null,
            currentPowerUp: null,
          },
          selectedCardIndex: null,
        });

        if (nextPhase === 'game_over') {
          get().revealAllCards();
        }
      },

      revealAllCards: () => {
        const { game } = get();
        if (!game) return;

        const updatedPlayers = game.players.map(player => ({
          ...player,
          cards: player.cards.map(card => ({ ...card, faceUp: true })),
        }));

        // Calculate scores and determine winner
        const scores = updatedPlayers.map(player => ({
          id: player.id,
          name: player.name,
          score: calculateScore(player.cards),
          calledReds: player.id === game.redsCallerId,
        }));

        scores.sort((a, b) => a.score - b.score);
        const winner = scores[0];

        set({
          game: {
            ...game,
            players: updatedPlayers,
            winner: winner.id,
            lastAction: `Game over! ${winner.name} wins with ${winner.score} points!`,
          },
        });
      },

      selectCard: (index) => {
        set({ selectedCardIndex: index });
      },

      setInspectedCard: (info) => {
        set({ inspectedCard: info });
      },

      syncState: (state) => {
        set({ game: state });
      },

      resetGame: () => {
        set({
          game: null,
          selectedCardIndex: null,
          inspectedCard: null,
          showingBottomCards: false,
          isHost: false,
        });
      },
    }),
    {
      name: 'reds-game-storage',
      partialize: (state) => ({
        playerName: state.playerName,
      }),
    }
  )
);

function getPowerUpDescription(type: string): string {
  switch (type) {
    case 'inspect_own': return 'Inspect one of your cards';
    case 'inspect_other': return 'Inspect another player\'s card';
    case 'blind_swap': return 'Blindly swap with another player';
    case 'inspect_swap': return 'Inspect and swap with another player';
    default: return '';
  }
}

