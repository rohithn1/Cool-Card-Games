import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { 
  GameState, 
  Player, 
  Card, 
  GamePhase, 
  TurnPhase,
  PowerUpAction,
  PowerUpType,
  StackAction,
  StackAnimation,
  StackRaceAnimation,
  SwapAnimation,
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
  startGame: (deckCount?: number) => void;
  markReady: () => void;
  
  // Game actions
  viewBottomCards: () => void;
  finishViewingCards: () => void;
  drawCard: (fromDiscard: boolean) => void;
  swapCard: (cardIndex: number) => void;
  discardCard: () => void;
  
  // Power-up actions
  startPowerUp: (action: PowerUpAction) => void;
  usePowerUp: () => void;
  skipPowerUp: () => void;
  completePowerUp: (targetPlayerId?: string, targetCardIndex?: number, sourceCardIndex?: number, secondTargetPlayerId?: string, secondTargetCardIndex?: number) => void;
  cancelPowerUp: () => void;
  
  // Stacking (with race support)
  attemptStack: (playerCardIndex: number, targetPlayerId?: string, targetCardIndex?: number, sourcePosition?: { x: number; y: number }) => void;
  joinStackRace: (stackAction: StackAction) => void;
  resolveStackRace: () => void;
  setStackRaceDiscardPosition: (discardPos: { x: number; y: number }) => void;
  updateStackRaceAnimationPhase: (playerId: string, phase: 'flying_to_discard' | 'at_discard' | 'flying_back' | 'done') => void;
  clearStackRace: () => void;
  // Legacy single-stack support
  setStackPositions: (sourcePos: { x: number; y: number }, discardPos: { x: number; y: number }) => void;
  setStackPhase: (phase: 'flying_to_discard' | 'showing_result' | 'flying_back' | 'completed') => void;
  resolveStackAnimation: () => void;
  completeStackGive: (cardIndexToGive: number) => void;
  clearStackAnimation: () => void;
  
  // Swap animation (for showing blind swaps to all players)
  startSwapAnimation: (swapType: PowerUpType, targetPlayerId: string, targetCardIndex: number, sourceCardIndex?: number, secondTargetPlayerId?: string, secondTargetCardIndex?: number) => void;
  setSwapSelection: (targetPlayerId: string | null, targetCardIndex: number | null, sourceCardIndex: number | null, swapType: PowerUpType | null, secondTargetPlayerId?: string | null, secondTargetCardIndex?: number | null) => void;
  clearSwapAnimation: () => void;
  clearPenaltyCardDisplay: () => void;
  setCardMoveAnimation: (animation: GameState['cardMoveAnimation']) => void;
  clearCardMoveAnimation: () => void;
  
  // End game
  callReds: () => void;
  endTurn: () => void;
  revealAllCards: () => void;
  
  // UI actions
  selectCard: (index: number | null) => void;
  setInspectedCard: (info: { playerId: string; cardIndex: number; card: Card } | null) => void;
  setInspectingCard: (info: { playerId: string; cardIndex: number } | null) => void;
  
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
  stackAnimation: null,
  stackRaceAnimation: null,
  swapAnimation: null,
  lastDiscardWasStack: false,
  redsCallerId: null,
  finalRoundTurnsRemaining: 0,
  winner: null,
  lastAction: '',
  stateVersion: 0,
  inspectingCard: null,
  penaltyCardDisplay: null,
  cardMoveAnimation: null,
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
          isReady: false,
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
            stateVersion: (game.stateVersion || 0) + 1,
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
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },

      startGame: (deckCount: number = 1) => {
        const { game } = get();
        if (!game || game.players.length < 2) return;

        const deck = shuffleDeck(createDeck(deckCount));
        const { playerHands, remainingDeck } = dealCards(deck, game.players.length);
        
        // Take the first card from deck for discard pile
        const [firstDiscard, ...finalDeck] = remainingDeck;

        const updatedPlayers = game.players.map((player, index) => ({
          ...player,
          cards: playerHands[index],
          hasSeenBottomCards: false, // Everyone needs to click Ready
          hasCalledReds: false,
        }));

        set({
          game: {
            ...game,
            phase: 'viewing_cards', // Start in viewing phase
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
            lastAction: 'Game started! Memorize your bottom 2 cards, then click Ready.',
            stateVersion: (game.stateVersion || 0) + 1,
          },
          showingBottomCards: true,
        });
      },

      markReady: () => {
        const { game, peerId } = get();
        if (!game) return;

        const updatedPlayers = game.players.map(player => {
          if (player.id === peerId) {
            return { ...player, hasSeenBottomCards: true };
          }
          return player;
        });

        const allReady = updatedPlayers.every(p => p.hasSeenBottomCards);

        set({
          showingBottomCards: false, // Hide my bottom cards after clicking ready
          game: {
            ...game,
            players: updatedPlayers,
            phase: allReady ? 'playing' : 'viewing_cards',
            lastAction: allReady 
              ? 'All players ready! Host draws first.' 
              : `Waiting for ${updatedPlayers.filter(p => !p.hasSeenBottomCards).length} player(s) to be ready...`,
            stateVersion: (game.stateVersion || 0) + 1,
          },
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
            stateVersion: (game.stateVersion || 0) + 1,
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
              stateVersion: (game.stateVersion || 0) + 1,
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
                stateVersion: (game.stateVersion || 0) + 1,
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
                stateVersion: (game.stateVersion || 0) + 1,
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

        // Check if the OLD card (from hand) triggers a power-up
        const powerUp = getCardPowerUp(oldCard);

        if (powerUp) {
          // Go to power-up choice phase - player can choose to use or skip
          set({
            game: {
              ...game,
              players: updatedPlayers,
              discardPile: [{ ...oldCard, faceUp: true }, ...game.discardPile],
              drawnCard: null,
              turnPhase: 'power_up', // Auto-activate power-up (user can skip with button)
              lastDiscardWasStack: false,
              currentPowerUp: {
                type: powerUp,
                sourcePlayerId: peerId!,
              },
              lastAction: `${currentPlayer.name} swapped - ${powerUp} power-up ready!`,
              stateVersion: (game.stateVersion || 0) + 1,
            },
            selectedCardIndex: null,
          });
        } else {
          // Regular swap, no power-up
          set({
            game: {
              ...game,
              players: updatedPlayers,
              discardPile: [{ ...oldCard, faceUp: true }, ...game.discardPile],
              drawnCard: null,
              turnPhase: 'draw',
              lastDiscardWasStack: false,
              lastAction: `${currentPlayer.name} swapped a card`,
              stateVersion: (game.stateVersion || 0) + 1,
            },
            selectedCardIndex: null,
          });

          // Auto end turn after swap
          get().endTurn();
        }
      },

      discardCard: () => {
        const { game, peerId } = get();
        if (!game || !game.drawnCard || game.turnPhase !== 'decide') return;

        const currentPlayer = game.players[game.currentPlayerIndex];
        if (currentPlayer.id !== peerId) return;

        const basePowerUp = getCardPowerUp(game.drawnCard);
        const playerHasNoCards = currentPlayer.cards.length === 0;
        const otherPlayersCount = game.players.length - 1;
        
        // Determine the actual power-up based on player's card count
        let powerUp = basePowerUp;
        let powerUpDescription = '';
        
        if (basePowerUp && playerHasNoCards) {
          switch (basePowerUp) {
            case 'inspect_own':
              // 7 with 0 cards = no power-up (nothing to inspect)
              powerUp = null;
              break;
            case 'inspect_other':
              // 8 with 0 cards = still works (inspect opponent's card)
              powerUp = 'inspect_other';
              powerUpDescription = 'inspect_other';
              break;
            case 'blind_swap':
              // 9 with 0 cards = swap 2 opponents' cards blindly (if 2+ other players)
              if (otherPlayersCount >= 2) {
                powerUp = 'blind_swap_others';
                powerUpDescription = 'blind_swap_others';
              } else {
                powerUp = null; // Can't swap opponents if only 1 other player
              }
              break;
            case 'inspect_swap':
              // 10 with 0 cards = inspect and swap 2 opponents' cards (if 2+ other players)
              if (otherPlayersCount >= 2) {
                powerUp = 'inspect_swap_others';
                powerUpDescription = 'inspect_swap_others';
              } else {
                // With only 1 opponent, can still inspect their card but not swap
                powerUp = 'inspect_other';
                powerUpDescription = 'inspect_other';
              }
              break;
          }
        }

        if (powerUp) {
          // Go to power-up choice phase - player can choose to use or skip
          set({
            game: {
              ...game,
              discardPile: [{ ...game.drawnCard, faceUp: true }, ...game.discardPile],
              drawnCard: null,
              turnPhase: 'power_up', // Auto-activate power-up (user can skip with button)
              lastDiscardWasStack: false, // Normal discard, stacking allowed
              currentPowerUp: {
                type: powerUp,
                sourcePlayerId: peerId!,
              },
              lastAction: `Discarded ${game.drawnCard.rank} - ${getPowerUpDescription(powerUp)} ready!`,
              stateVersion: (game.stateVersion || 0) + 1,
            },
          });
        } else {
          // Regular discard (or power-up not usable) - combine discard and end turn into one state change
          let nextPhase = game.phase;
          let turnsRemaining = game.finalRoundTurnsRemaining;
          
          // In final round, decrement turns remaining
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
              discardPile: [{ ...game.drawnCard, faceUp: true }, ...game.discardPile],
              drawnCard: null,
              currentPlayerIndex: finalNextIndex,
              turnPhase: 'draw',
              phase: nextPhase,
              finalRoundTurnsRemaining: turnsRemaining,
              currentPowerUp: null,
              lastDiscardWasStack: false,
              lastAction: `Discarded a ${game.drawnCard.rank}`,
              stateVersion: (game.stateVersion || 0) + 1,
            },
            selectedCardIndex: null,
          });

          if (nextPhase === 'game_over') {
            get().revealAllCards();
          }
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
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },

      usePowerUp: () => {
        // No longer needed - power-up is auto-activated
        // Keeping for backwards compatibility
      },

      skipPowerUp: () => {
        const { game } = get();
        if (!game || game.turnPhase !== 'power_up') return;

        const currentPlayer = game.players[game.currentPlayerIndex];

        // Calculate next player and phase directly here instead of calling endTurn
        let nextPhase = game.phase;
        let turnsRemaining = game.finalRoundTurnsRemaining;
        
        // In final round, decrement turns remaining
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
            inspectingCard: null,
            swapAnimation: null,
            lastAction: `${currentPlayer.name} skipped power-up`,
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
        
        if (nextPhase === 'game_over') {
          get().revealAllCards();
        }
      },

      completePowerUp: (targetPlayerId, targetCardIndex, sourceCardIdx, secondTargetPlayerId, secondTargetCardIndex) => {
        const { game, peerId } = get();
        if (!game || !game.currentPowerUp) return;

        const { type, sourceCardIndex: storedSourceCardIndex } = game.currentPowerUp;
        // Use passed sourceCardIdx if provided, otherwise use stored one
        const sourceCardIndex = sourceCardIdx !== undefined ? sourceCardIdx : storedSourceCardIndex;
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
            // Blindly swap cards with another player
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
            // Inspect and optionally swap with another player
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
            
          case 'blind_swap_others':
            // Blindly swap cards between two OTHER players (when you have 0 cards)
            if (targetPlayerId && targetCardIndex !== undefined && 
                secondTargetPlayerId && secondTargetCardIndex !== undefined) {
              const firstTargetIdx = updatedPlayers.findIndex(p => p.id === targetPlayerId);
              const secondTargetIdx = updatedPlayers.findIndex(p => p.id === secondTargetPlayerId);
              
              if (firstTargetIdx !== -1 && secondTargetIdx !== -1) {
                const temp = updatedPlayers[firstTargetIdx].cards[targetCardIndex];
                updatedPlayers[firstTargetIdx].cards[targetCardIndex] = 
                  updatedPlayers[secondTargetIdx].cards[secondTargetCardIndex];
                updatedPlayers[secondTargetIdx].cards[secondTargetCardIndex] = temp;
                lastAction = 'Swapped cards between two opponents';
              }
            }
            break;
            
          case 'inspect_swap_others':
            // Inspect and swap cards between two OTHER players (when you have 0 cards)
            if (targetPlayerId && targetCardIndex !== undefined && 
                secondTargetPlayerId && secondTargetCardIndex !== undefined) {
              const firstTargetIdx = updatedPlayers.findIndex(p => p.id === targetPlayerId);
              const secondTargetIdx = updatedPlayers.findIndex(p => p.id === secondTargetPlayerId);
              
              if (firstTargetIdx !== -1 && secondTargetIdx !== -1) {
                const temp = updatedPlayers[firstTargetIdx].cards[targetCardIndex];
                updatedPlayers[firstTargetIdx].cards[targetCardIndex] = 
                  updatedPlayers[secondTargetIdx].cards[secondTargetCardIndex];
                updatedPlayers[secondTargetIdx].cards[secondTargetCardIndex] = temp;
                lastAction = 'Inspected and swapped opponents\' cards';
              }
            } else {
              lastAction = 'Inspected opponents\' cards but did not swap';
            }
            break;
        }

        // Calculate next player and phase directly here instead of calling endTurn
        let nextPhase = game.phase;
        let turnsRemaining = game.finalRoundTurnsRemaining;
        
        // In final round, decrement turns remaining
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
            players: updatedPlayers,
            currentPlayerIndex: finalNextIndex,
            currentPowerUp: null,
            turnPhase: 'draw',
            phase: nextPhase,
            finalRoundTurnsRemaining: turnsRemaining,
            drawnCard: null,
            lastAction,
            inspectingCard: null,
            swapAnimation: null,
            stateVersion: (game.stateVersion || 0) + 1,
          },
          inspectedCard: null,
          selectedCardIndex: null,
        });

        if (nextPhase === 'game_over') {
          get().revealAllCards();
        }
      },

      cancelPowerUp: () => {
        const { game } = get();
        if (!game) return;

        // Calculate next player and phase directly here instead of calling endTurn
        let nextPhase = game.phase;
        let turnsRemaining = game.finalRoundTurnsRemaining;
        
        // In final round, decrement turns remaining
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
            currentPowerUp: null,
            turnPhase: 'draw',
            phase: nextPhase,
            finalRoundTurnsRemaining: turnsRemaining,
            drawnCard: null,
            inspectingCard: null,
            swapAnimation: null,
            lastAction: 'Skipped power-up',
            stateVersion: (game.stateVersion || 0) + 1,
          },
          inspectedCard: null,
          selectedCardIndex: null,
        });

        if (nextPhase === 'game_over') {
          get().revealAllCards();
        }
      },

      attemptStack: (playerCardIndex, targetPlayerId, targetCardIndex, sourcePosition) => {
        const { game, peerId } = get();
        if (!game || game.discardPile.length === 0) return;

        // Can't stack if the top card came from a previous stack
        if (game.lastDiscardWasStack) {
          set({
            game: {
              ...game,
              lastAction: 'Cannot stack - wait for a new card to be discarded!',
            },
            selectedCardIndex: null,
          });
          return;
        }

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

        const timestamp = Date.now();
        const stackAction: StackAction = {
          playerId: peerId!,
          playerName: currentPlayer.name,
          playerCardIndex,
          card: stackCard,
          targetPlayerId,
          targetCardIndex,
          timestamp,
          sourcePosition: sourcePosition || { x: window.innerWidth / 2, y: window.innerHeight },
          status: 'pending',
        };

        // Check if there's already an ongoing stack race
        const existingRace = game.stackRaceAnimation;
        const RACE_WINDOW_MS = 600; // Time window to collect stacks
        
        if (existingRace && existingRace.phase === 'collecting') {
          // Join existing race - add our stack attempt
          const updatedStacks = [...existingRace.stacks, stackAction];
          set({
            game: {
              ...game,
              stackRaceAnimation: {
                ...existingRace,
                stacks: updatedStacks,
              },
              lastAction: `${currentPlayer.name} joined the stack race!`,
              stateVersion: (game.stateVersion || 0) + 1,
            },
            selectedCardIndex: null,
          });
        } else {
          // Start a new stack race
          const newRace: StackRaceAnimation = {
            stacks: [stackAction],
            discardPosition: undefined,
            phase: 'collecting',
            raceWindowMs: RACE_WINDOW_MS,
            startedAt: timestamp,
            winnerId: null,
            winnerCard: null,
            results: {},
          };
          
          set({
            game: {
              ...game,
              stackRaceAnimation: newRace,
              lastAction: `${currentPlayer.name} is attempting to stack...`,
              stateVersion: (game.stateVersion || 0) + 1,
            },
            selectedCardIndex: null,
          });
        }
      },
      
      joinStackRace: (stackAction) => {
        const { game } = get();
        if (!game) return;
        
        const existingRace = game.stackRaceAnimation;
        if (!existingRace) {
          // Start a new race with this action
          const newRace: StackRaceAnimation = {
            stacks: [stackAction],
            discardPosition: undefined,
            phase: 'collecting',
            raceWindowMs: 600,
            startedAt: stackAction.timestamp,
            winnerId: null,
            winnerCard: null,
            results: {},
          };
          set({
            game: {
              ...game,
              stackRaceAnimation: newRace,
              lastAction: `${stackAction.playerName} is attempting to stack...`,
              stateVersion: (game.stateVersion || 0) + 1,
            },
          });
        } else {
          // Add to existing race (avoid duplicates)
          const alreadyInRace = existingRace.stacks.some(s => 
            s.playerId === stackAction.playerId && s.timestamp === stackAction.timestamp
          );
          if (!alreadyInRace) {
            set({
              game: {
                ...game,
                stackRaceAnimation: {
                  ...existingRace,
                  stacks: [...existingRace.stacks, stackAction],
                },
                lastAction: `${stackAction.playerName} joined the stack race!`,
                stateVersion: (game.stateVersion || 0) + 1,
              },
            });
          }
        }
      },
      
      resolveStackRace: () => {
        const { game, peerId } = get();
        if (!game || !game.stackRaceAnimation) return;
        
        const race = game.stackRaceAnimation;
        if (race.phase !== 'collecting' && race.phase !== 'racing') return;
        
        const topDiscard = game.discardPile[0];
        
        // Sort stacks by timestamp (earliest first)
        const sortedStacks = [...race.stacks].sort((a, b) => a.timestamp - b.timestamp);
        
        // Find the first valid stack (matching card)
        let winnerId: string | null = null;
        let winnerCard: Card | null = null;
        let winnerStack: StackAction | null = null;
        
        const results: StackRaceAnimation['results'] = {};
        
        for (const stack of sortedStacks) {
          const isMatch = cardsMatch(stack.card, topDiscard);
          const isWinner = isMatch && winnerId === null;
          
          if (isWinner) {
            winnerId = stack.playerId;
            winnerCard = stack.card;
            winnerStack = stack;
          }
          
          results[stack.playerId] = {
            success: isMatch,
            isWinner,
            card: stack.card,
            sourcePosition: stack.sourcePosition || { x: window.innerWidth / 2, y: window.innerHeight },
            animationPhase: 'flying_to_discard',
          };
          
          // Update stack status
          stack.status = isWinner ? 'winner' : (isMatch ? 'loser' : 'invalid');
        }
        
        // Update game state with resolved race
        let updatedPlayers = [...game.players];
        let updatedDiscardPile = [...game.discardPile];
        let lastAction = '';
        let awaitingCardGive = false;
        
        if (winnerStack && winnerId && winnerCard) {
          // Check if stacking opponent's card (requires giving a card back)
          const isStackingOpponentCard = winnerStack.targetPlayerId !== undefined;
          
          if (isStackingOpponentCard) {
            // DON'T remove the card yet - wait for stacker to select which card to give
            // The card will be removed in completeStackGive
            awaitingCardGive = true;
            lastAction = `${winnerStack.playerName} stacked ${game.players.find(p => p.id === winnerStack.targetPlayerId)?.name}'s card! Select a card to give.`;
          } else {
            // Stacking own card - remove it immediately
            const winnerPlayerIdx = updatedPlayers.findIndex(p => p.id === winnerId);
            if (winnerPlayerIdx >= 0) {
              const winnerPlayer = { ...updatedPlayers[winnerPlayerIdx] };
              winnerPlayer.cards = winnerPlayer.cards.filter((_, i) => i !== winnerStack.playerCardIndex);
              updatedPlayers[winnerPlayerIdx] = winnerPlayer;
            }
            
            // Add winning card to discard pile
            const cardToDiscard: Card = { ...winnerCard, faceUp: true };
            updatedDiscardPile = [cardToDiscard, ...updatedDiscardPile];
            lastAction = `${winnerStack.playerName} won the stack race!`;
          }
        } else {
          // No valid stacks - all were misstacks
          lastAction = sortedStacks.length > 1 
            ? 'All stack attempts failed - MISSTACK!' 
            : `${sortedStacks[0]?.playerName || 'Player'} MISSTACKED!`;
        }
        
        set({
          game: {
            ...game,
            stackRaceAnimation: {
              ...race,
              phase: 'resolving',
              winnerId,
              winnerCard,
              winnerStack, // Store the winner stack for card give
              results,
              stacks: sortedStacks,
              awaitingCardGive, // Track if we need to wait for card selection
            },
            players: updatedPlayers,
            discardPile: updatedDiscardPile,
            lastDiscardWasStack: winnerId !== null && !awaitingCardGive, // Only set if completed
            lastAction,
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
        
        // Handle misstacks - give penalty cards
        for (const stack of sortedStacks) {
          if (results[stack.playerId] && !results[stack.playerId].success) {
            // This player misstacked - they get a penalty card
            // We'll handle this after the animation completes
          }
        }
      },
      
      setStackRaceDiscardPosition: (discardPos) => {
        const { game } = get();
        if (!game || !game.stackRaceAnimation) return;
        
        set({
          game: {
            ...game,
            stackRaceAnimation: {
              ...game.stackRaceAnimation,
              discardPosition: discardPos,
            },
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },
      
      updateStackRaceAnimationPhase: (playerId, phase) => {
        const { game } = get();
        if (!game || !game.stackRaceAnimation) return;
        
        const results = { ...game.stackRaceAnimation.results };
        if (results[playerId]) {
          results[playerId] = { ...results[playerId], animationPhase: phase };
        }
        
        set({
          game: {
            ...game,
            stackRaceAnimation: {
              ...game.stackRaceAnimation,
              results,
            },
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },
      
      clearStackRace: () => {
        const { game, peerId } = get();
        if (!game || !game.stackRaceAnimation) return;
        
        const race = game.stackRaceAnimation;
        let updatedDeck = [...game.deck];
        let updatedPlayers = [...game.players];
        let penaltyDisplay: GameState['penaltyCardDisplay'] = null;
        
        // Only give penalty cards to players who stacked the WRONG card (misstack)
        // Players who stacked the right card but were too slow do NOT get a penalty
        for (const stack of race.stacks) {
          const result = race.results[stack.playerId];
          // Only penalize if success is FALSE (wrong card), not if they just lost the race
          if (result && result.success === false) {
            // Misstack (wrong card) - draw penalty card FACE DOWN (player doesn't see it)
            const playerIdx = updatedPlayers.findIndex(p => p.id === stack.playerId);
            if (playerIdx >= 0 && updatedDeck.length > 0) {
              const [penaltyCard, ...remainingDeck] = updatedDeck;
              updatedDeck = remainingDeck;
              
              const player = { ...updatedPlayers[playerIdx] };
              // Card goes face-down - player doesn't get to see what they drew
              player.cards = [...player.cards, { ...penaltyCard, faceUp: false }];
              updatedPlayers[playerIdx] = player;
              
              // Set penalty display for face-down card animation (shown for last misstacker)
              penaltyDisplay = {
                card: penaltyCard, // Stored but displayed face-down
                playerId: stack.playerId,
                playerName: stack.playerName,
                shownAt: Date.now(),
              };
            }
          }
          // Note: Players with result.success === true but result.isWinner === false
          // were just too slow - they don't get a penalty, their card just returns
        }
        
        set({
          game: {
            ...game,
            stackRaceAnimation: null,
            deck: updatedDeck,
            players: updatedPlayers,
            // Show face-down card animation for penalty
            penaltyCardDisplay: penaltyDisplay,
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },

      setStackPositions: (sourcePos, discardPos) => {
        const { game } = get();
        if (!game || !game.stackAnimation) return;
        
        set({
          game: {
            ...game,
            stackAnimation: {
              ...game.stackAnimation,
              sourcePosition: sourcePos,
              discardPosition: discardPos,
            },
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },
      
      setStackPhase: (phase) => {
        const { game } = get();
        if (!game || !game.stackAnimation) return;
        
        set({
          game: {
            ...game,
            stackAnimation: {
              ...game.stackAnimation,
              phase,
            },
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },

      resolveStackAnimation: () => {
        const { game, peerId } = get();
        if (!game || !game.stackAnimation || game.stackAnimation.stacks.length === 0) return;
        if (game.stackAnimation.result) return; // Already showing result

        const stack = game.stackAnimation.stacks[0];
        const topDiscard = game.discardPile[0];
        const currentPlayer = game.players.find(p => p.id === stack.playerId);
        
        // Check if the stack was correct
        const isMatch = cardsMatch(stack.card, topDiscard);
        const isStackingOpponentCard = stack.targetPlayerId !== undefined;
        
        if (!isMatch) {
          // MISTACK - Set phase to flying_back so card animates back
          set({
            game: {
              ...game,
              stackAnimation: {
                ...game.stackAnimation,
                phase: 'flying_back',
                result: {
                  success: false,
                  stackedCard: stack.card,
                  stackerId: stack.playerId,
                  stackerName: stack.playerName,
                  targetPlayerId: stack.targetPlayerId,
                  targetCardIndex: stack.targetCardIndex,
                },
              },
              lastAction: `${stack.playerName} MISSTACKED! Wrong card!`,
              stateVersion: (game.stateVersion || 0) + 1,
            },
          });
        } else {
          // SUCCESS - Card stays at discard
          set({
            game: {
              ...game,
              stackAnimation: {
                ...game.stackAnimation,
                phase: 'showing_result',
                winnerId: stack.playerId,
                result: {
                  success: true,
                  stackedCard: stack.card,
                  stackerId: stack.playerId,
                  stackerName: stack.playerName,
                  targetPlayerId: stack.targetPlayerId,
                  targetCardIndex: stack.targetCardIndex,
                  awaitingCardGive: isStackingOpponentCard,
                },
              },
              lastDiscardWasStack: true,
              lastAction: isStackingOpponentCard 
                ? `${stack.playerName} stacked successfully! Select a card to give.`
                : `${stack.playerName} stacked successfully!`,
              stateVersion: (game.stateVersion || 0) + 1,
            },
          });
          
          // If not stacking opponent's card, complete the stack automatically
          if (!isStackingOpponentCard) {
            const updatedPlayers = [...game.players];
            const playerIdx = updatedPlayers.findIndex(p => p.id === stack.playerId);
            if (playerIdx !== -1) {
              const stackedCard = updatedPlayers[playerIdx].cards[stack.playerCardIndex];
              updatedPlayers[playerIdx].cards.splice(stack.playerCardIndex, 1);
              
              set({
                game: {
                  ...game,
                  players: updatedPlayers,
                  discardPile: [{ ...stackedCard, faceUp: true }, ...game.discardPile],
                  stackAnimation: {
                    ...game.stackAnimation!,
                    winnerId: stack.playerId,
                    resolvedAt: Date.now(),
                    result: {
                      success: true,
                      stackedCard: stack.card,
                      stackerId: stack.playerId,
                      stackerName: stack.playerName,
                    },
                  },
                  lastDiscardWasStack: true,
                  lastAction: `${stack.playerName} stacked successfully!`,
                  stateVersion: (game.stateVersion || 0) + 1,
                },
              });
            }
          }
        }
      },
      
      // Complete stack when player selects which card to give
      completeStackGive: (cardIndexToGive: number) => {
        const { game, peerId } = get();
        if (!game) return;
        
        // Handle stack race case first
        if (game.stackRaceAnimation?.awaitingCardGive && game.stackRaceAnimation.winnerStack) {
          const winnerStack = game.stackRaceAnimation.winnerStack;
          const { targetPlayerId, targetCardIndex, playerId: stackerId, playerName: stackerName } = winnerStack;
          
          if (!targetPlayerId || targetCardIndex === undefined) return;
          
          const updatedPlayers = [...game.players];
          const stackerIdx = updatedPlayers.findIndex(p => p.id === stackerId);
          const targetIdx = updatedPlayers.findIndex(p => p.id === targetPlayerId);
          
          if (stackerIdx === -1 || targetIdx === -1) return;
          
          // Get the card being stacked (from target player)
          const stackedCard = updatedPlayers[targetIdx].cards[targetCardIndex];
          
          // Get the card to give (from stacker)
          const cardToGive = updatedPlayers[stackerIdx].cards[cardIndexToGive];
          
          // Remove stacked card from target
          updatedPlayers[targetIdx].cards.splice(targetCardIndex, 1);
          
          // Remove card to give from stacker
          updatedPlayers[stackerIdx].cards.splice(cardIndexToGive, 1);
          
          // Give card to target INTO the emptied slot (so the position is obvious)
          updatedPlayers[targetIdx].cards.splice(targetCardIndex, 0, { ...cardToGive, faceUp: false });
          
          // Add stacked card to discard
          const newDiscardPile = [{ ...stackedCard, faceUp: true }, ...game.discardPile];
          
          const targetPlayer = game.players.find(p => p.id === targetPlayerId);
          
          set({
            game: {
              ...game,
              players: updatedPlayers,
              discardPile: newDiscardPile,
              cardMoveAnimation: {
                type: 'give',
                playerId: stackerId,
                playerName: stackerName,
                // Move the given card (always face-down)
                drawnCard: { ...cardToGive, faceUp: false },
                discardedCard: null,
                handIndex: cardIndexToGive,
                targetPlayerId,
                targetHandIndex: targetCardIndex,
                startedAt: Date.now(),
              },
              stackRaceAnimation: {
                ...game.stackRaceAnimation,
                awaitingCardGive: false,
              },
              lastDiscardWasStack: true,
              lastAction: `${stackerName} gave a card to ${targetPlayer?.name}!`,
              stateVersion: (game.stateVersion || 0) + 1,
            },
          });
          return;
        }
        
        // Handle legacy single-stack case
        if (!game.stackAnimation?.result) return;
        
        const { success, targetPlayerId, targetCardIndex, stackerId, stackerName } = game.stackAnimation.result;
        if (!success || !targetPlayerId || targetCardIndex === undefined) return;
        
        const updatedPlayers = [...game.players];
        const stackerIdx = updatedPlayers.findIndex(p => p.id === stackerId);
        const targetIdx = updatedPlayers.findIndex(p => p.id === targetPlayerId);
        
        if (stackerIdx === -1 || targetIdx === -1) return;
        
        // Get the card being stacked (from target player)
        const stackedCard = updatedPlayers[targetIdx].cards[targetCardIndex];
        
        // Get the card to give (from stacker)
        const cardToGive = updatedPlayers[stackerIdx].cards[cardIndexToGive];
        
        // Remove stacked card from target
        updatedPlayers[targetIdx].cards.splice(targetCardIndex, 1);
        
        // Remove card to give from stacker
        updatedPlayers[stackerIdx].cards.splice(cardIndexToGive, 1);
        
        // Give card to target INTO the emptied slot (so the position is obvious)
        updatedPlayers[targetIdx].cards.splice(targetCardIndex, 0, { ...cardToGive, faceUp: false });
        
        // Add stacked card to discard
        const newDiscardPile = [{ ...stackedCard, faceUp: true }, ...game.discardPile];
        
        const targetPlayer = game.players.find(p => p.id === targetPlayerId);
        
        set({
          game: {
            ...game,
            players: updatedPlayers,
            discardPile: newDiscardPile,
            cardMoveAnimation: {
              type: 'give',
              playerId: stackerId,
              playerName: stackerName,
              // Move the given card (always face-down)
              drawnCard: { ...cardToGive, faceUp: false },
              discardedCard: null,
              handIndex: cardIndexToGive,
              targetPlayerId,
              targetHandIndex: targetCardIndex,
              startedAt: Date.now(),
            },
            stackAnimation: {
              ...game.stackAnimation,
              result: {
                ...game.stackAnimation.result,
                awaitingCardGive: false,
              },
              resolvedAt: Date.now(),
            },
            lastAction: `${stackerName} gave a card to ${targetPlayer?.name}!`,
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },

      clearStackAnimation: () => {
        const { game, peerId } = get();
        if (!game) return;
        
        // If misstack, apply penalty and show face-down card animation
        if (game.stackAnimation?.result && !game.stackAnimation.result.success) {
          if (game.deck.length > 0) {
            const { card: penaltyCard, remainingDeck } = drawFromDeck(game.deck);
            if (penaltyCard) {
              const updatedPlayers = [...game.players];
              const stackerId = game.stackAnimation!.result!.stackerId;
              const playerIdx = updatedPlayers.findIndex(p => p.id === stackerId);
              const stackerName = game.stackAnimation.result.stackerName;
              
              if (playerIdx !== -1) {
                // Add the penalty card (keep it face down - player doesn't see it)
                updatedPlayers[playerIdx].cards.push({ ...penaltyCard, faceUp: false });
              }
              
              set({
                game: {
                  ...game,
                  players: updatedPlayers,
                  deck: remainingDeck,
                  stackAnimation: null,
                  // Set penaltyCardDisplay to trigger face-down card animation
                  // The card is stored but displayed face-down in the animation
                  penaltyCardDisplay: {
                    card: penaltyCard, // Stored but shown face-down
                    playerId: stackerId,
                    playerName: stackerName,
                    shownAt: Date.now(),
                  },
                  lastAction: `${stackerName} drew a penalty card!`,
                  stateVersion: (game.stateVersion || 0) + 1,
                },
              });
              return;
            }
          }
        }
        
        set({
          game: {
            ...game,
            stackAnimation: null,
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },

      startSwapAnimation: (swapType, targetPlayerId, targetCardIndex, sourceCardIndex, secondTargetPlayerId, secondTargetCardIndex) => {
        const { game, peerId } = get();
        if (!game) return;
        
        const currentPlayer = game.players[game.currentPlayerIndex];
        
        const swapAnimation: SwapAnimation = {
          type: swapType as SwapAnimation['type'],
          playerId: peerId!,
          playerName: currentPlayer.name,
          sourcePlayerId: peerId!,
          sourceCardIndex,
          targetPlayerId,
          targetCardIndex,
          secondTargetPlayerId,
          secondTargetCardIndex,
          phase: 'animating',
          startedAt: Date.now(),
        };
        
        set({
          game: {
            ...game,
            swapAnimation,
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },
      
      setSwapSelection: (targetPlayerId, targetCardIndex, sourceCardIndex, swapType, secondTargetPlayerId, secondTargetCardIndex) => {
        const { game, peerId } = get();
        if (!game) return;
        
        // If no swap type, clear selection
        if (!swapType) {
          set({
            game: {
              ...game,
              swapAnimation: null,
              stateVersion: (game.stateVersion || 0) + 1,
            },
          });
          return;
        }
        
        const currentPlayer = game.players[game.currentPlayerIndex];
        
        // For _others swaps, use passed second target OR preserve existing
        const existingSwap = game.swapAnimation;
        const isOthersSwap = swapType === 'blind_swap_others' || swapType === 'inspect_swap_others';
        
        // Determine second target: use passed params if provided, otherwise preserve existing
        const resolvedSecondTargetPlayerId = isOthersSwap 
          ? (secondTargetPlayerId ?? existingSwap?.secondTargetPlayerId ?? undefined)
          : undefined;
        const resolvedSecondTargetCardIndex = isOthersSwap 
          ? (secondTargetCardIndex ?? existingSwap?.secondTargetCardIndex ?? undefined)
          : undefined;
        
        // Allow partial selections (only source OR only target selected)
        // This broadcasts the selection state so other players can see highlighting
        const swapAnimation: SwapAnimation = {
          type: swapType as SwapAnimation['type'],
          playerId: peerId!,
          playerName: currentPlayer.name,
          sourcePlayerId: peerId!,
          sourceCardIndex: sourceCardIndex ?? undefined,
          targetPlayerId: targetPlayerId ?? undefined,
          targetCardIndex: targetCardIndex ?? undefined,
          secondTargetPlayerId: resolvedSecondTargetPlayerId,
          secondTargetCardIndex: resolvedSecondTargetCardIndex,
          phase: 'selecting',
          startedAt: Date.now(),
        };
        
        set({
          game: {
            ...game,
            swapAnimation,
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },
      
      clearSwapAnimation: () => {
        const { game } = get();
        if (!game) return;
        
        set({
          game: {
            ...game,
            swapAnimation: null,
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },

      clearPenaltyCardDisplay: () => {
        const { game } = get();
        if (!game) return;
        
        set({
          game: {
            ...game,
            penaltyCardDisplay: null,
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },

      setCardMoveAnimation: (animation) => {
        const { game } = get();
        if (!game) return;
        
        set({
          game: {
            ...game,
            cardMoveAnimation: animation,
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },

      clearCardMoveAnimation: () => {
        const { game } = get();
        if (!game) return;
        
        set({
          game: {
            ...game,
            cardMoveAnimation: null,
            stateVersion: (game.stateVersion || 0) + 1,
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

        // All OTHER players get 1 turn each
        // We set to players.length - 1 because the reds caller forfeits their turn
        const nextPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;

        set({
          game: {
            ...game,
            phase: 'final_round',
            redsCallerId: peerId!,
            finalRoundTurnsRemaining: game.players.length - 1, // Other players get 1 turn each
            players: updatedPlayers,
            currentPlayerIndex: nextPlayerIndex,
            turnPhase: 'draw',
            drawnCard: null,
            currentPowerUp: null,
            lastAction: `${currentPlayer.name} called REDS! Everyone else gets 1 final turn.`,
            stateVersion: (game.stateVersion || 0) + 1,
          },
          selectedCardIndex: null,
        });
      },

      endTurn: () => {
        const { game } = get();
        if (!game) return;

        let nextPhase = game.phase;
        let turnsRemaining = game.finalRoundTurnsRemaining;
        
        // In final round, decrement turns remaining when a player completes their turn
        if (game.phase === 'final_round') {
          turnsRemaining--;
          if (turnsRemaining <= 0) {
            nextPhase = 'game_over';
          }
        }

        const nextPlayerIndex = (game.currentPlayerIndex + 1) % game.players.length;
        
        // Skip the player who called reds in final round (they already forfeited their turn)
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
            stateVersion: (game.stateVersion || 0) + 1,
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
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
      },

      selectCard: (index) => {
        set({ selectedCardIndex: index });
      },

      setInspectedCard: (info) => {
        const { game } = get();
        
        // Update local UI state
        set({ inspectedCard: info });
        
        // Also update game state so other players can see which card is being inspected
        if (game) {
          set({
            game: {
              ...game,
              inspectingCard: info ? { playerId: info.playerId, cardIndex: info.cardIndex } : null,
            },
          });
        }
      },
      
      setInspectingCard: (info) => {
        const { game } = get();
        if (!game) return;
        
        set({
          game: {
            ...game,
            inspectingCard: info,
            stateVersion: (game.stateVersion || 0) + 1,
          },
        });
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
    case 'blind_swap_others': return 'Swap 2 opponents\' cards (blind)';
    case 'inspect_swap_others': return 'Inspect and swap 2 opponents\' cards';
    default: return '';
  }
}

