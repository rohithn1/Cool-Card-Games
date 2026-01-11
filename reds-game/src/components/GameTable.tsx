'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Card } from './Card';
import { Deck, DiscardPile } from './Card';
import { PlayerHand, OpponentHand } from './PlayerHand';
import { motion, AnimatePresence } from 'framer-motion';
import { getCardPowerUp, PowerUpType, Card as CardType } from '@/types/game';
import { getMultiplayerConnection } from '@/lib/multiplayer';
import { useCardPositions } from '@/lib/useCardPositions';

// Hook to detect if we're on mobile
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768 || 'ontouchstart' in window);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);
  
  return isMobile;
}

// Card dimensions (lg size)
const CARD_WIDTH = 80;
const CARD_HEIGHT = 112;
const CARD_GAP = 12;

// Animation timing constants (in ms)
const ANIMATION_TIMING = {
  draw: 500,
  swap: 1200, // Increased for sequential animations
  discard: 600,
  stack: 800,
  powerUp: 600,
  announcement: 2500,
};

// Helper component to trigger stack animation resolution
function StackAnimationResolver() {
  const { resolveStackAnimation } = useGameStore();
  
  useEffect(() => {
    // Wait for flying animation to complete before resolving
    // Flying takes ~600ms, then we resolve to show result
    const timer = setTimeout(() => {
      resolveStackAnimation();
    }, 700);
    
    return () => clearTimeout(timer);
  }, [resolveStackAnimation]);
  
  return null;
}

// Helper component to clear stack animation after showing result
function StackAnimationClearer() {
  const { clearStackAnimation } = useGameStore();
  const game = useGameStore(state => state.game);
  
  useEffect(() => {
    // Wait for:
    // - Success: show result for 1.5s then clear
    // - Misstack: flying back animation (~500ms) + result display (~1.5s)
    const isMisstack = game?.stackAnimation?.result?.success === false;
    const delay = isMisstack ? 2200 : 1800;
    
    const timer = setTimeout(() => {
      clearStackAnimation();
    }, delay);
    
    return () => clearTimeout(timer);
  }, [clearStackAnimation, game?.stackAnimation?.result?.success]);
  
  return null;
}

// Stack Race Resolver - waits for collection window then resolves the race
function StackRaceResolver() {
  const { resolveStackRace } = useGameStore();
  const game = useGameStore(state => state.game);
  
  useEffect(() => {
    if (!game?.stackRaceAnimation || game.stackRaceAnimation.phase !== 'collecting') return;
    
    const race = game.stackRaceAnimation;
    const elapsed = Date.now() - race.startedAt;
    const remaining = Math.max(0, race.raceWindowMs - elapsed);
    
    // Wait for race window to close, then resolve
    const timer = setTimeout(() => {
      resolveStackRace();
    }, remaining + 100); // Small buffer
    
    return () => clearTimeout(timer);
  }, [resolveStackRace, game?.stackRaceAnimation?.phase, game?.stackRaceAnimation?.startedAt]);
  
  return null;
}

// Stack Race Clearer - cleans up after all animations complete
function StackRaceClearer() {
  const { clearStackRace } = useGameStore();
  const game = useGameStore(state => state.game);
  
  useEffect(() => {
    if (!game?.stackRaceAnimation || game.stackRaceAnimation.phase !== 'resolving') return;
    
    // Wait for:
    // - Flying to discard: ~600ms
    // - Show result: ~1500ms
    // - Flying back (for losers): ~500ms
    const hasLosers = Object.values(game.stackRaceAnimation.results).some(r => !r.success || !r.isWinner);
    const delay = hasLosers ? 3000 : 2200;
    
    const timer = setTimeout(() => {
      clearStackRace();
    }, delay);
    
    return () => clearTimeout(timer);
  }, [clearStackRace, game?.stackRaceAnimation?.phase]);
  
  return null;
}

// Penalty Animation Clearer - auto-clears penalty card animation
function PenaltyAnimationClearer() {
  const { clearPenaltyCardDisplay } = useGameStore();
  
  useEffect(() => {
    // Auto-clear after animation completes (800ms flight + 500ms display)
    const timer = setTimeout(() => {
      clearPenaltyCardDisplay();
    }, 1500);
    
    return () => clearTimeout(timer);
  }, [clearPenaltyCardDisplay]);
  
  return null;
}

export function GameTable() {
  const {
    game,
    peerId,
    isHost,
    selectedCardIndex,
    inspectedCard,
    selectCard,
    setInspectedCard,
    drawCard,
    swapCard,
    discardCard,
    startPowerUp,
    usePowerUp,
    skipPowerUp,
    completePowerUp,
    cancelPowerUp,
    attemptStack,
    joinStackRace,
    resolveStackRace,
    setStackRaceDiscardPosition,
    updateStackRaceAnimationPhase,
    clearStackRace,
    setStackPositions,
    setStackPhase,
    callReds,
    markReady,
    startSwapAnimation,
    setSwapSelection,
    clearSwapAnimation,
    clearPenaltyCardDisplay,
    setCardMoveAnimation,
    clearCardMoveAnimation,
  } = useGameStore();

  const [showInstructions, setShowInstructions] = useState(true);
  const [showGameOverPanel, setShowGameOverPanel] = useState(true);
  const [drawAnimation, setDrawAnimation] = useState<'deck' | 'discard' | null>(null);
  const [drawnCardSource, setDrawnCardSource] = useState<'deck' | 'discard' | null>(null);
  const [swapAnimation, setSwapAnimation] = useState<{ cardIndex: number; card: CardType } | null>(null);
  
  // Refs for precise positioning
  const deckRef = useRef<HTMLDivElement>(null);
  const discardRef = useRef<HTMLDivElement>(null);
  const drawnCardRef = useRef<HTMLDivElement>(null);
  const myHandRef = useRef<HTMLDivElement>(null);
  
  // Get center position of an element
  const getElementCenter = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    if (!ref.current) return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    const rect = ref.current.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };
  }, []);
  
  // Get position for a card in my hand (2x2 grid at bottom)
  const getMyHandCardPosition = useCallback((cardIndex: number) => {
    if (myHandRef.current) {
      const rect = myHandRef.current.getBoundingClientRect();
      // 2x2 grid: index 0,1 = top row, index 2,3 = bottom row
      const col = cardIndex % 2;
      const row = Math.floor(cardIndex / 2);
      return {
        x: rect.left + col * (CARD_WIDTH + CARD_GAP) + CARD_WIDTH / 2 + 10, // +10 for padding
        y: rect.top + row * (CARD_HEIGHT + CARD_GAP) + CARD_HEIGHT / 2 + 10,
      };
    }
    // Fallback: calculate based on window
    const centerX = window.innerWidth / 2;
    const bottomY = window.innerHeight - 150;
    const col = cardIndex % 2;
    const row = Math.floor(cardIndex / 2);
    return {
      x: centerX + (col === 0 ? -50 : 50),
      y: bottomY + row * (CARD_HEIGHT + CARD_GAP),
    };
  }, []);
  
  // Card movement animation - persists card data for smooth animations after state change
  const [cardMoveAnim, setCardMoveAnim] = useState<{
    type: 'discard_drawn' | 'swap_cards' | null;
    drawnCard: CardType | null;
    handCard: CardType | null;
    handIndex: number | null;
    startTime: number;
    // Pre-calculated positions for precise animations
    handPos?: { x: number; y: number };
    discardPos?: { x: number; y: number };
    drawnPos?: { x: number; y: number };
  }>({ type: null, drawnCard: null, handCard: null, handIndex: null, startTime: 0 });
  
  // Action announcement overlay
  const [actionAnnouncement, setActionAnnouncement] = useState<{
    type: 'swap' | 'stack' | 'discard' | 'draw';
    playerName: string;
    card?: CardType;
  } | null>(null);
  
  // Power-up swap animation state
  const [powerUpSwapAnim, setPowerUpSwapAnim] = useState<{
    myCardIndex: number | null;
    opponentId: string | null;
    opponentCardIndex: number | null;
    // For _others power-ups (selecting two opponents)
    secondOpponentId: string | null;
    secondOpponentCardIndex: number | null;
    phase: 'idle' | 'selecting' | 'confirmed' | 'animating' | 'revealing';
    myCard?: CardType | null;
    opponentCard?: CardType | null;
    secondOpponentCard?: CardType | null;
  }>({
    myCardIndex: null,
    opponentId: null,
    opponentCardIndex: null,
    secondOpponentId: null,
    secondOpponentCardIndex: null,
    phase: 'idle',
  });
  
  // Power-up usage notification (shows to all players)
  const [powerUpNotification, setPowerUpNotification] = useState<{
    playerName: string;
    action: 'used' | 'skipped';
    powerUpType: PowerUpType;
  } | null>(null);
  
  // REDS call notification (shows prominently to all players)
  const [redsNotification, setRedsNotification] = useState<{
    playerName: string;
    isMe: boolean;
  } | null>(null);
  
  // Triple-click tracking for stacking
  const clickCountRef = useRef<{ [key: string]: { count: number; timer: NodeJS.Timeout | null; lastClickTime?: number } }>({});
  const TRIPLE_CLICK_WINDOW = 700; // ms to register triple click (slightly slower)

  // Prevent double-select while stack-give is being processed/broadcast
  const isGivingCardRef = useRef(false);
  
  // Track last action for animations
  const lastActionRef = useRef<string>('');
  
  // Detect game actions and show announcements
  useEffect(() => {
    if (!game || game.lastAction === lastActionRef.current) return;
    
    const action = game.lastAction;
    lastActionRef.current = action;
    
    // Parse the action to show appropriate animation
    // Note: Swap animations are handled separately via swapAnimation state, no popup needed
    if (action.includes('stacked')) {
      const playerName = action.split(' stacked')[0];
      setActionAnnouncement({ type: 'stack', playerName });
      setTimeout(() => setActionAnnouncement(null), ANIMATION_TIMING.announcement);
    } else if (action.includes('discarded')) {
      const playerName = action.split(' discarded')[0];
      setActionAnnouncement({ type: 'discard', playerName });
      setTimeout(() => setActionAnnouncement(null), ANIMATION_TIMING.announcement);
    } else if (action.includes('drew')) {
      const playerName = action.split(' drew')[0];
      setActionAnnouncement({ type: 'draw', playerName });
      setTimeout(() => setActionAnnouncement(null), ANIMATION_TIMING.announcement);
    } else if (action.includes('called REDS')) {
      const playerName = action.split(' called REDS')[0];
      const callerIsMe = game?.redsCallerId === peerId;
      setRedsNotification({ playerName, isMe: callerIsMe });
      // Keep REDS notification visible longer
      setTimeout(() => setRedsNotification(null), 5000);
    }
  }, [game?.lastAction, game?.redsCallerId, peerId]);
  
  // Reset power-up swap animation when turn phase changes
  useEffect(() => {
    if (game?.turnPhase !== 'power_up') {
      setPowerUpSwapAnim({
        myCardIndex: null,
        opponentId: null,
        opponentCardIndex: null,
        secondOpponentId: null,
        secondOpponentCardIndex: null,
        phase: 'selecting',
      });
    }
  }, [game?.turnPhase]);

  // Reset drawnCardSource when turn phase goes back to draw (new turn started)
  useEffect(() => {
    if (game?.turnPhase === 'draw') {
      setDrawnCardSource(null);
    }
  }, [game?.turnPhase, game?.currentPlayerIndex]);
  
  // Detect power-up usage/skip and show notification
  const lastPowerUpActionRef = useRef<string>('');
  useEffect(() => {
    if (!game) return;
    
    const action = game.lastAction;
    if (action === lastPowerUpActionRef.current) return;
    lastPowerUpActionRef.current = action;
    
    // Detect power-up used
    if (action.includes('used') && (action.includes('7') || action.includes('8') || action.includes('9') || action.includes('10'))) {
      const playerName = action.split(' used')[0];
      let powerUpType: PowerUpType = 'inspect_own';
      if (action.includes('7')) powerUpType = 'inspect_own';
      else if (action.includes('8')) powerUpType = 'inspect_other';
      else if (action.includes('9')) powerUpType = 'blind_swap';
      else if (action.includes('10')) powerUpType = 'inspect_swap';
      
      setPowerUpNotification({ playerName, action: 'used', powerUpType });
      setTimeout(() => setPowerUpNotification(null), ANIMATION_TIMING.announcement);
    }
    
    // Detect power-up skipped
    if (action.includes('skipped')) {
      const playerName = action.split(' skipped')[0];
      setPowerUpNotification({ playerName, action: 'skipped', powerUpType: 'inspect_own' });
      setTimeout(() => setPowerUpNotification(null), ANIMATION_TIMING.announcement);
    }
  }, [game?.lastAction]);

  // Use the coordinate position system
  const cardPositions = useCardPositions({
    players: game?.players || [],
    myPlayerId: peerId,
  });

  if (!game) return null;

  const currentPlayer = game.players[game.currentPlayerIndex];
  const isMyTurn = currentPlayer?.id === peerId;
  const myPlayerIndex = game.players.findIndex(p => p.id === peerId);
  const myPlayer = game.players[myPlayerIndex];
  
  const isViewingMyCards = myPlayer && !myPlayer.hasSeenBottomCards;
  const allPlayersReady = game.players.every(p => p.hasSeenBottomCards);
  const gameIsActive = game.phase === 'playing' || game.phase === 'final_round';

  const opponents = game.players.filter(p => p.id !== peerId);

  // Triple-click handler for stacking
  const handleTripleClick = (cardKey: string, onTripleClick: () => void) => {
    const now = Date.now();
    
    if (!clickCountRef.current[cardKey]) {
      clickCountRef.current[cardKey] = { count: 0, timer: null };
    }
    
    const clickData = clickCountRef.current[cardKey];
    
    // Clear existing timer
    if (clickData.timer) {
      clearTimeout(clickData.timer);
    }
    
    // Increment click count
    clickData.count++;
    
    // Check for triple click
    if (clickData.count >= 3) {
      clickData.count = 0;
      onTripleClick();
      return;
    }
    
    // Set timer to reset count
    clickData.timer = setTimeout(() => {
      clickData.count = 0;
    }, TRIPLE_CLICK_WINDOW);
  };

  // Handle deck click - always draws from deck (if it's your turn to draw)
  const handleDeckClick = () => {
    if (!allPlayersReady) return;
    if (!isMyTurn || game.turnPhase !== 'draw') return;
    
    // Set animation in game state so all players see it
    setCardMoveAnimation({
      type: 'draw_deck',
      playerId: peerId!,
      playerName: myPlayer?.name || 'Player',
      drawnCard: null, // Card is unknown until drawn
      discardedCard: null,
      handIndex: null,
      startedAt: Date.now(),
    });
    setDrawAnimation('deck');
    setDrawnCardSource('deck');
    setTimeout(() => {
      drawCard(false);
      setDrawAnimation(null);
      clearCardMoveAnimation();
    }, ANIMATION_TIMING.draw);
  };

  // Handle discard pile click
  const handleDiscardClick = () => {
    if (!allPlayersReady) return;
    
    // If it's my turn and I'm in draw phase → draw from discard
    if (game.turnPhase === 'draw' && isMyTurn) {
      // Set animation in game state so all players see it
      setCardMoveAnimation({
        type: 'draw_discard',
        playerId: peerId!,
        playerName: myPlayer?.name || 'Player',
        drawnCard: game.discardPile[0] ? { ...game.discardPile[0], faceUp: true } : null,
        discardedCard: null,
        handIndex: null,
        startedAt: Date.now(),
      });
      setDrawAnimation('discard');
      setDrawnCardSource('discard');
      setTimeout(() => {
        drawCard(true);
        setDrawAnimation(null);
        clearCardMoveAnimation();
      }, ANIMATION_TIMING.draw);
      return;
    }
    
    // If it's my turn and I'm in decide phase → only allow discard if card came from DECK
    // Cards from discard pile MUST be swapped with one of your cards
    if (game.turnPhase === 'decide' && isMyTurn && drawnCardSource !== 'discard') {
      if (game.drawnCard) {
        // Set animation in game state so all players see it
        setCardMoveAnimation({
          type: 'discard',
          playerId: peerId!,
          playerName: myPlayer?.name || 'Player',
          drawnCard: { ...game.drawnCard, faceUp: true },
          discardedCard: { ...game.drawnCard, faceUp: true },
          handIndex: null,
          startedAt: Date.now(),
        });
        // Also keep local state for the sideways animation BEFORE state change
        // Calculate exact positions using refs
        const discardPos = getElementCenter(discardRef);
        const drawnPos = drawnCardRef.current 
          ? getElementCenter(drawnCardRef) 
          : { x: window.innerWidth / 2 + 100, y: window.innerHeight / 2 };
        setCardMoveAnim({
          type: 'discard_drawn',
          drawnCard: { ...game.drawnCard },
          handCard: null,
          handIndex: null,
          startTime: Date.now(),
          drawnPos,
          discardPos,
        });
        setDrawnCardSource(null);
        setTimeout(() => {
          discardCard();
          clearCardMoveAnimation();
          // Clear animation after it completes
          setTimeout(() => {
            setCardMoveAnim({ type: null, drawnCard: null, handCard: null, handIndex: null, startTime: 0 });
          }, 400);
        }, ANIMATION_TIMING.discard);
      }
      return;
    }
  };

  // Handle my card click
  const handleMyCardClick = (index: number) => {
    if (!allPlayersReady) return;
    
    if (game.phase === 'viewing_cards') return;

    // CARD GIVE MODE: If we just stacked an opponent's card, select which card to give them
    // Check both legacy stackAnimation and new stackRaceAnimation
    const isAwaitingCardGive = 
      (game.stackAnimation?.result?.awaitingCardGive && game.stackAnimation.result.stackerId === peerId) ||
      (game.stackRaceAnimation?.awaitingCardGive && game.stackRaceAnimation.winnerId === peerId);
    
    if (isAwaitingCardGive) {
      if (isGivingCardRef.current) return;
      isGivingCardRef.current = true;
      const { completeStackGive } = useGameStore.getState();
      completeStackGive(index);
      return;
    }

    // Triple-click detection FIRST - for stacking
    const isCardBeingInspected = inspectedCard?.playerId === peerId && inspectedCard?.cardIndex === index;
    if (gameIsActive && !isCardBeingInspected) {
      const cardKey = `my-${index}`;
      const now = Date.now();
      
      if (!clickCountRef.current[cardKey]) {
        clickCountRef.current[cardKey] = { count: 0, timer: null, lastClickTime: 0 };
      }
      
      const clickData = clickCountRef.current[cardKey];
      const timeSinceLastClick = now - (clickData.lastClickTime || 0);
      
      // If clicks are happening fast (within 400ms), count them
      if (timeSinceLastClick < 400) {
        clickData.count++;
      } else {
        clickData.count = 1;
      }
      clickData.lastClickTime = now;
      
      // If triple click detected, attempt stack
      if (clickData.count >= 3) {
        clickData.count = 0;
        
        // Get actual DOM positions for accurate animation
        const cardElements = myHandRef.current?.querySelectorAll('[data-card-index]');
        const cardEl = cardElements?.[index] as HTMLElement | undefined;
        const discardEl = discardRef.current;
        
        let sourcePosition = { x: window.innerWidth / 2, y: window.innerHeight };
        let discardPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        
        if (cardEl) {
          const cardRect = cardEl.getBoundingClientRect();
          sourcePosition = { x: cardRect.left + cardRect.width / 2, y: cardRect.top + cardRect.height / 2 };
        }
        
        if (discardEl) {
          const discardRect = discardEl.getBoundingClientRect();
          discardPosition = { x: discardRect.left + discardRect.width / 2, y: discardRect.top + discardRect.height / 2 };
        }
        
        // Set discard position for animation
        setStackRaceDiscardPosition(discardPosition);
        
        // Attempt stack with source position
        attemptStack(index, undefined, undefined, sourcePosition);
        
        // After stack, player can still use power-up by clicking again
        return;
      }
    }

    // If I have a drawn card and it's decide phase → swap
    if (game.turnPhase === 'decide' && isMyTurn && game.drawnCard) {
      const oldCard = myPlayer.cards[index];
      // Set animation in game state so all players see it
      setCardMoveAnimation({
        type: 'swap',
        playerId: peerId!,
        playerName: myPlayer?.name || 'Player',
        drawnCard: { ...game.drawnCard, faceUp: false }, // Face down for others
        discardedCard: { ...oldCard, faceUp: true }, // This card goes to discard
        handIndex: index,
        startedAt: Date.now(),
      });
      // Store card data for animation BEFORE state change
      // Calculate exact positions using refs
      const handPos = getMyHandCardPosition(index);
      const discardPos = getElementCenter(discardRef);
      const drawnPos = drawnCardRef.current 
        ? getElementCenter(drawnCardRef) 
        : { x: window.innerWidth / 2 + 100, y: window.innerHeight / 2 };
      setCardMoveAnim({
        type: 'swap_cards',
        drawnCard: { ...game.drawnCard },
        handCard: { ...oldCard },
        handIndex: index,
        startTime: Date.now(),
        handPos,
        discardPos,
        drawnPos,
      });
      setSwapAnimation({ cardIndex: index, card: oldCard });
      setTimeout(() => {
        swapCard(index);
        setSwapAnimation(null);
        clearCardMoveAnimation();
        // Clear animation after it completes
        setTimeout(() => {
          setCardMoveAnim({ type: null, drawnCard: null, handCard: null, handIndex: null, startTime: 0 });
        }, 400);
      }, ANIMATION_TIMING.swap);
      return;
    }

    // Power-up handling (only runs if not a triple-click)
    if (game.turnPhase === 'power_up' && game.currentPowerUp && isMyTurn) {
      const { type } = game.currentPowerUp;
      
      if (type === 'inspect_own') {
        // If clicking the same card that's already being inspected, close inspection
        if (inspectedCard && inspectedCard.playerId === peerId && inspectedCard.cardIndex === index) {
          handleCloseInspection();
          return;
        }
        
        // Set inspecting card in game state for real-time sync
        const { setInspectingCard } = useGameStore.getState();
        setInspectingCard({ playerId: peerId!, cardIndex: index });
        // Also set local inspectedCard for the flip animation
        setInspectedCard({
          playerId: peerId!,
          cardIndex: index,
          card: myPlayer.cards[index],
        });
        return;
      }

      // For blind_swap (9) or inspect_swap (10) - select my card
      if (type === 'blind_swap' || type === 'inspect_swap') {
        // Don't allow re-selection once both cards are selected (phase is confirmed or beyond)
        if (powerUpSwapAnim.phase === 'confirmed' || powerUpSwapAnim.phase === 'animating' || powerUpSwapAnim.phase === 'revealing') {
          return;
        }
        
        setPowerUpSwapAnim(prev => ({
          ...prev,
          myCardIndex: index,
          myCard: myPlayer.cards[index],
          phase: prev.opponentCardIndex !== null ? 'confirmed' : 'selecting',
        }));
        
        // Sync selection to all players
        if (powerUpSwapAnim.opponentId && powerUpSwapAnim.opponentCardIndex !== null) {
          // Both cards selected - sync and execute
          setSwapSelection(powerUpSwapAnim.opponentId, powerUpSwapAnim.opponentCardIndex, index, type);
          executePowerUpSwap(index, powerUpSwapAnim.opponentId, powerUpSwapAnim.opponentCardIndex, type);
        } else {
          // Only my card selected - sync partial selection
          setSwapSelection(null, null, index, type);
        }
        return;
      }
    }
  };

  // Reset local give-guard once the store clears awaitingCardGive
  useEffect(() => {
    const legacyAwaiting = game?.stackAnimation?.result?.awaitingCardGive;
    const raceAwaiting = game?.stackRaceAnimation?.awaitingCardGive;
    if (!legacyAwaiting && !raceAwaiting) {
      isGivingCardRef.current = false;
    }
  }, [game?.stackAnimation?.result?.awaitingCardGive, game?.stackRaceAnimation?.awaitingCardGive]);

  // Auto-clear give animation shortly after it starts (only the initiator clears to avoid races)
  useEffect(() => {
    if (!game?.cardMoveAnimation) return;
    if (game.cardMoveAnimation.type !== 'give') return;
    if (game.cardMoveAnimation.playerId !== peerId) return;
    const timer = setTimeout(() => {
      clearCardMoveAnimation();
    }, 1400);
    return () => clearTimeout(timer);
  }, [game?.cardMoveAnimation?.type, game?.cardMoveAnimation?.startedAt, game?.cardMoveAnimation?.playerId, peerId, clearCardMoveAnimation]);

  // Handle opponent card click
  const handleOpponentCardClick = (playerId: string, cardIndex: number) => {
    // Triple-click detection FIRST - for stacking
    const isCardBeingInspected = inspectedCard?.playerId === playerId && inspectedCard?.cardIndex === cardIndex;
    if (gameIsActive && myPlayer && myPlayer.cards.length > 0 && !isCardBeingInspected) {
      const cardKey = `opp-${playerId}-${cardIndex}`;
      const now = Date.now();
      
      if (!clickCountRef.current[cardKey]) {
        clickCountRef.current[cardKey] = { count: 0, timer: null, lastClickTime: 0 };
      }
      
      const clickData = clickCountRef.current[cardKey];
      const timeSinceLastClick = now - (clickData.lastClickTime || 0);
      
      // If clicks are happening fast (within 400ms), count them
      if (timeSinceLastClick < 400) {
        clickData.count++;
      } else {
        clickData.count = 1;
      }
      clickData.lastClickTime = now;
      
      // If triple click detected, attempt stack
      if (clickData.count >= 3) {
        clickData.count = 0;
        // Stack opponent's card using my first card
        
        // Get actual DOM positions for accurate animation
        const opponentHandEl = document.querySelector(`[data-opponent-id="${playerId}"]`);
        const cardEl = opponentHandEl?.querySelectorAll('[data-card-index]')[cardIndex] as HTMLElement | undefined;
        const discardEl = discardRef.current;
        
        let sourcePosition = { x: window.innerWidth / 2, y: window.innerHeight / 3 };
        let discardPosition = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
        
        if (cardEl) {
          const cardRect = cardEl.getBoundingClientRect();
          sourcePosition = { x: cardRect.left + cardRect.width / 2, y: cardRect.top + cardRect.height / 2 };
        }
        
        if (discardEl) {
          const discardRect = discardEl.getBoundingClientRect();
          discardPosition = { x: discardRect.left + discardRect.width / 2, y: discardRect.top + discardRect.height / 2 };
        }
        
        // Set discard position for animation
        setStackRaceDiscardPosition(discardPosition);
        
        // Attempt stack with source position
        attemptStack(0, playerId, cardIndex, sourcePosition);
        return;
      }
    }

    // Power-up handling (only runs if not a triple-click)
    if (game.turnPhase === 'power_up' && game.currentPowerUp && isMyTurn) {
      const { type } = game.currentPowerUp;
      const targetPlayer = game.players.find(p => p.id === playerId);

      if (type === 'inspect_other') {
        // If clicking the same card that's already being inspected, close inspection
        if (inspectedCard && inspectedCard.playerId === playerId && inspectedCard.cardIndex === cardIndex) {
          handleCloseInspection();
          return;
        }
        
        if (targetPlayer) {
          // Set inspecting card in game state for real-time sync
          const { setInspectingCard } = useGameStore.getState();
          setInspectingCard({ playerId, cardIndex });
          // Also set local inspectedCard for viewing
          setInspectedCard({
            playerId,
            cardIndex,
            card: targetPlayer.cards[cardIndex],
          });
        }
        return;
      }

      // For blind_swap (9) or inspect_swap (10) - select opponent's card
      if (type === 'blind_swap' || type === 'inspect_swap') {
        // Don't allow re-selection once both cards are selected (phase is confirmed or beyond)
        if (powerUpSwapAnim.phase === 'confirmed' || powerUpSwapAnim.phase === 'animating' || powerUpSwapAnim.phase === 'revealing') {
          return;
        }
        
        if (targetPlayer) {
          setPowerUpSwapAnim(prev => ({
            ...prev,
            opponentId: playerId,
            opponentCardIndex: cardIndex,
            opponentCard: targetPlayer.cards[cardIndex],
            phase: prev.myCardIndex !== null ? 'confirmed' : 'selecting',
          }));
          
          // Sync selection to all players
          if (powerUpSwapAnim.myCardIndex !== null) {
            // Both cards selected - sync and execute
            setSwapSelection(playerId, cardIndex, powerUpSwapAnim.myCardIndex, type);
            executePowerUpSwap(powerUpSwapAnim.myCardIndex, playerId, cardIndex, type);
          } else {
            // Only opponent card selected - sync partial selection
            setSwapSelection(playerId, cardIndex, null, type);
          }
        }
        return;
      }
      
      // For blind_swap_others (9 with 0 cards) or inspect_swap_others (10 with 0 cards)
      // Select TWO opponent cards
      if (type === 'blind_swap_others' || type === 'inspect_swap_others') {
        // Don't allow re-selection once both cards are selected (phase is confirmed or beyond)
        if (powerUpSwapAnim.phase === 'confirmed' || powerUpSwapAnim.phase === 'animating' || powerUpSwapAnim.phase === 'revealing') {
          return;
        }
        
        if (targetPlayer) {
          // If first opponent not selected yet
          if (powerUpSwapAnim.opponentId === null) {
            setPowerUpSwapAnim(prev => ({
              ...prev,
              opponentId: playerId,
              opponentCardIndex: cardIndex,
              opponentCard: targetPlayer.cards[cardIndex],
              phase: 'selecting',
            }));
            // Sync first selection to all players
            setSwapSelection(playerId, cardIndex, null, type);
          } 
          // If first is selected but second is not (and it's a different card)
          else if (powerUpSwapAnim.secondOpponentId === null && 
                   !(powerUpSwapAnim.opponentId === playerId && powerUpSwapAnim.opponentCardIndex === cardIndex)) {
            setPowerUpSwapAnim(prev => ({
              ...prev,
              secondOpponentId: playerId,
              secondOpponentCardIndex: cardIndex,
              secondOpponentCard: targetPlayer.cards[cardIndex],
              phase: 'confirmed',
            }));
            
            // Sync BOTH selections to all players so spectators see both highlights
            setSwapSelection(
              powerUpSwapAnim.opponentId!, 
              powerUpSwapAnim.opponentCardIndex!, 
              null, 
              type,
              playerId,
              cardIndex
            );
            
            // Execute the swap between the two opponents
            executeOthersSwap(
              powerUpSwapAnim.opponentId!, 
              powerUpSwapAnim.opponentCardIndex!, 
              playerId, 
              cardIndex, 
              type
            );
          }
        }
        return;
      }
    }
  };
  
  // Execute power-up swap with animation
  const executePowerUpSwap = (myCardIdx: number, oppId: string, oppCardIdx: number, type: PowerUpType) => {
    const targetPlayer = game.players.find(p => p.id === oppId);
    if (!targetPlayer || !myPlayer) return;
    
    // Set to confirmed phase (both cards green)
    setPowerUpSwapAnim({
      myCardIndex: myCardIdx,
      opponentId: oppId,
      opponentCardIndex: oppCardIdx,
      secondOpponentId: null,
      secondOpponentCardIndex: null,
      myCard: myPlayer.cards[myCardIdx],
      opponentCard: targetPlayer.cards[oppCardIdx],
      phase: 'confirmed',
    });
    
    // After brief pause, animate
    setTimeout(() => {
      setPowerUpSwapAnim(prev => ({ ...prev, phase: 'animating' }));
      
      // For inspect_swap (10), show revealing phase and wait for user decision
      // DON'T call startSwapAnimation here - wait until user clicks "Swap Cards"
      // The highlight sync is already done via setSwapSelection
      if (type === 'inspect_swap') {
        setTimeout(() => {
          setPowerUpSwapAnim(prev => ({ ...prev, phase: 'revealing' }));
          // Don't auto-complete - wait for user to click Swap or Keep button
        }, 1000);
      } else {
        // For blind_swap (9), start the synced animation so all players see it
        startSwapAnimation('blind_swap', oppId, oppCardIdx, myCardIdx);
        
        // Complete immediately after animation
        setTimeout(() => {
          completePowerUp(oppId, oppCardIdx, myCardIdx);
          clearSwapAnimation();
          setPowerUpSwapAnim({
            myCardIndex: null,
            opponentId: null,
            opponentCardIndex: null,
            secondOpponentId: null,
            secondOpponentCardIndex: null,
            myCard: null,
            opponentCard: null,
            phase: 'idle',
          });
        }, 1000);
      }
    }, 700);
  };
  
  // Execute swap between two opponents (when player has 0 cards)
  const executeOthersSwap = (
    firstOppId: string, 
    firstOppCardIdx: number, 
    secondOppId: string, 
    secondOppCardIdx: number, 
    type: PowerUpType
  ) => {
    const firstPlayer = game.players.find(p => p.id === firstOppId);
    const secondPlayer = game.players.find(p => p.id === secondOppId);
    if (!firstPlayer || !secondPlayer) return;
    
    // After brief pause, animate
    setTimeout(() => {
      setPowerUpSwapAnim(prev => ({ ...prev, phase: 'animating' }));
      
      // For inspect_swap_others (10), show revealing phase and wait for user decision
      // DON'T call startSwapAnimation here - wait until user clicks "Swap Cards"
      // The highlight sync is already done via setSwapSelection
      if (type === 'inspect_swap_others') {
        setTimeout(() => {
          setPowerUpSwapAnim(prev => ({ ...prev, phase: 'revealing' }));
          // Don't auto-complete - wait for user to click Swap or Keep button
        }, 1000);
      } else {
        // For blind_swap_others (9), start the synced animation so all players see it
        startSwapAnimation('blind_swap_others', firstOppId, firstOppCardIdx, undefined, secondOppId, secondOppCardIdx);
        
        // Complete immediately after animation
        setTimeout(() => {
          completePowerUp(firstOppId, firstOppCardIdx, undefined, secondOppId, secondOppCardIdx);
          clearSwapAnimation();
          setPowerUpSwapAnim({
            myCardIndex: null,
            opponentId: null,
            opponentCardIndex: null,
            secondOpponentId: null,
            secondOpponentCardIndex: null,
            myCard: null,
            opponentCard: null,
            secondOpponentCard: null,
            phase: 'idle',
          });
        }, 1000);
      }
    }, 700);
  };

  const handleCallReds = () => {
    if (!isMyTurn || game.phase !== 'playing' || game.turnPhase !== 'draw') return;
    callReds();
  };

  const handleReadyClick = () => {
    markReady();
    const mp = getMultiplayerConnection();
    if (isHost) {
      setTimeout(() => {
        const updatedGame = useGameStore.getState().game;
        if (updatedGame) mp.broadcastState(updatedGame);
      }, 50);
    } else {
      mp.sendToAll({
        type: 'player_ready',
        payload: { playerId: peerId },
      });
    }
  };

  // Complete inspection (close the side panel)
  const handleCloseInspection = () => {
    setInspectedCard(null);
    // completePowerUp already clears inspectingCard in game state
    if (game.currentPowerUp?.type === 'inspect_own' || game.currentPowerUp?.type === 'inspect_other') {
      completePowerUp();
    }
  };

  // Confirm swap after inspecting (for inspect_swap)
  const handleConfirmSwap = () => {
    if (inspectedCard && game.currentPowerUp?.type === 'inspect_swap') {
      // Start synced swap animation so all players see the swap
      if (game.currentPowerUp?.sourceCardIndex !== undefined) {
        startSwapAnimation('inspect_swap', inspectedCard.playerId, inspectedCard.cardIndex, game.currentPowerUp.sourceCardIndex);
      }
      completePowerUp(inspectedCard.playerId, inspectedCard.cardIndex);
      // Clear swap animation after it plays
      setTimeout(() => {
        clearSwapAnimation();
      }, ANIMATION_TIMING.swap);
      setInspectedCard(null);
    }
  };

  const handleCancelSwap = () => {
    setInspectedCard(null);
    completePowerUp();
  };

  const getInstructionText = () => {
    if (game.phase === 'waiting') return 'Waiting for players to join...';

    if (game.phase === 'viewing_cards') {
      if (isViewingMyCards) return 'Memorize your bottom 2 cards! Click "Ready" when done.';
      return `Waiting for ${game.players.filter(p => !p.hasSeenBottomCards).length} player(s) to be ready...`;
    }

    if (game.phase === 'game_over') {
      const winner = game.players.find(p => p.id === game.winner);
      return `Game Over! ${winner?.name} wins!`;
    }

    if (game.phase === 'final_round') {
      return `Final round! ${game.finalRoundTurnsRemaining} turns remaining.`;
    }

    if (!isMyTurn) {
      return `${currentPlayer?.name}'s turn...`;
    }

    if (game.turnPhase === 'draw') {
      return 'Draw from deck or discard pile.';
    }

    if (game.turnPhase === 'decide') {
      if (drawnCardSource === 'discard') {
        return 'You must swap this card with one of yours! (Cannot discard back)';
      }
      return 'Click a card to swap, or click discard pile to discard.';
    }

    if (game.turnPhase === 'power_up_choice') {
      // This phase is no longer used - power-ups auto-activate
      return 'Power-up ready!';
    }

    if (game.turnPhase === 'power_up' && game.currentPowerUp) {
      return getPowerUpInstruction(game.currentPowerUp.type);
    }

    return '';
  };

  const getPowerUpInstruction = (type: PowerUpType): string => {
    switch (type) {
      case 'inspect_own':
        return 'Click one of your cards to peek at it.';
      case 'inspect_other':
        return "Click an opponent's card to peek at it.";
      case 'blind_swap':
        return game.currentPowerUp?.sourceCardIndex !== undefined
          ? "Now click an opponent's card to swap with."
          : 'First click one of your cards to swap.';
      case 'inspect_swap':
        return game.currentPowerUp?.sourceCardIndex !== undefined
          ? "Click an opponent's card to inspect and optionally swap."
          : 'First click one of your cards to swap.';
      case 'blind_swap_others':
        return powerUpSwapAnim.opponentId 
          ? "Now click a SECOND opponent's card to complete the swap."
          : "Click TWO opponents' cards to swap them (blind).";
      case 'inspect_swap_others':
        return powerUpSwapAnim.opponentId 
          ? "Now click a SECOND opponent's card to inspect and swap."
          : "Click TWO opponents' cards to inspect and optionally swap.";
      default:
        return '';
    }
  };

  const getPowerUpName = (type: PowerUpType): string => {
    switch (type) {
      case 'inspect_own': return 'Peek at Own Card (7)';
      case 'inspect_other': return "Peek at Opponent's Card (8)";
      case 'blind_swap': return 'Blind Swap (9)';
      case 'inspect_swap': return 'Inspect & Swap (10)';
      case 'blind_swap_others': return 'Swap Opponents\' Cards (9)';
      case 'inspect_swap_others': return 'Inspect & Swap Opponents\' Cards (10)';
      default: return 'Power-Up';
    }
  };

  // Mobile pan state
  const isMobile = useIsMobile();
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const lastPanRef = useRef({ x: 0, y: 0 });
  
  // Calculate table size based on number of players
  const tableScale = opponents.length > 4 ? 1.6 : opponents.length > 2 ? 1.4 : 1.2;
  const tableWidth = isMobile ? `${100 * tableScale}%` : '100%';
  const tableHeight = isMobile ? `${100 * tableScale}%` : '100%';
  
  // Pan boundaries - allow scrolling to see the full expanded table
  // For a 1.4x scale, the extra width is 40% of viewport, so we need to pan at most 40% of viewport
  const maxPanX = isMobile ? (tableScale - 1) * 100 : 0; // % of viewport width
  const maxPanY = isMobile ? (tableScale - 1) * 80 : 0; // % of viewport height (less vertical since bottom bar is fixed)
  
  // Touch handlers for panning
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile || e.touches.length !== 1) return;
    
    // Don't start panning if touching an interactive element
    const target = e.target as HTMLElement;
    if (target.closest('button, [role="button"], .card-clickable')) return;
    
    panStartRef.current = {
      x: e.touches[0].clientX - lastPanRef.current.x,
      y: e.touches[0].clientY - lastPanRef.current.y,
    };
    setIsPanning(true);
  }, [isMobile]);
  
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPanning || !isMobile || e.touches.length !== 1) return;
    
    const newX = e.touches[0].clientX - panStartRef.current.x;
    const newY = e.touches[0].clientY - panStartRef.current.y;
    
    // Clamp to boundaries - allow scrolling to see full extended table
    const clampedX = Math.max(-maxPanX * window.innerWidth / 100, Math.min(maxPanX * window.innerWidth / 100, newX));
    const clampedY = Math.max(-maxPanY * window.innerHeight / 100, Math.min(maxPanY * window.innerHeight / 100 * 0.5, newY)); // Less vertical pan since bottom bar is fixed
    
    setPanPosition({ x: clampedX, y: clampedY });
    lastPanRef.current = { x: clampedX, y: clampedY };
  }, [isPanning, isMobile, maxPanX, maxPanY]);
  
  const handleTouchEnd = useCallback(() => {
    setIsPanning(false);
  }, []);

  return (
    <div className="fixed inset-0 w-full h-[100dvh] bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 overflow-hidden flex flex-col">
      {/* Main game area - scrollable on mobile */}
      <div 
        className="relative flex-1 overflow-hidden"
        style={{ paddingBottom: isMobile ? '140px' : '160px' }} // Space for player hand at bottom
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Pannable game table container */}
        <motion.div
          className="relative"
          style={{
            width: tableWidth,
            height: tableHeight,
            minWidth: '100%',
            minHeight: '100%',
            x: panPosition.x,
            y: panPosition.y,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        >
      {/* Felt texture overlay */}
      <div className="absolute inset-0 opacity-30 felt-pattern pointer-events-none" />

      {/* Compact game code - top left */}
      <div className="absolute top-2 left-2 bg-black/40 backdrop-blur-sm px-2 py-1 rounded z-20">
        <div className="text-emerald-400/70 text-[9px] uppercase tracking-wide">Code</div>
        <div className="text-white/90 font-mono text-xs font-bold tracking-wider">{game.gameCode}</div>
      </div>

      {/* Opponents in circular layout around the table */}
      {opponents.map((opponent, idx) => {
        // Calculate position around the table in a semi-circle
        // Player (you) is always at the bottom (180°), opponents spread across top arc
        const totalOpponents = opponents.length;
        
        // Spread opponents evenly across the top portion (from ~-80° to ~+80°)
        // More opponents = wider spread
        let angle: number;
        let x: number;
        let y: number;
        let rotationAngle: number;
        
        // Calculate spread angle based on number of opponents
        const maxSpread = Math.min(160, 40 + totalOpponents * 25); // 65° for 1, 90° for 2, up to 160° for 5+
        
        if (totalOpponents === 1) {
          // Single opponent directly across (top center)
          angle = 0;
          x = 50;
          y = 10;
          rotationAngle = 180;
        } else {
          // Multiple opponents - spread evenly across arc
          // Calculate angle for this opponent
          const step = maxSpread / (totalOpponents - 1);
          angle = -maxSpread / 2 + idx * step;
          
          // Convert angle to x,y position on a semi-ellipse
          // Use different radius for x (wider) and y (shorter) for better screen fit
          const radiusX = 42; // wider horizontal spread
          const radiusY = 36; // shorter vertical spread
          x = 50 + radiusX * Math.sin(angle * Math.PI / 180);
          y = 50 - radiusY * Math.cos(angle * Math.PI / 180);
          
          // Rotation should face toward center (player at bottom)
          rotationAngle = angle + 180;
        }
        
        // Get the inspecting card index for this opponent
        const opponentInspectingIndex = game.inspectingCard?.playerId === opponent.id 
          ? game.inspectingCard.cardIndex 
          : null;
        
        return (
          <div
            key={opponent.id}
            data-opponent-id={opponent.id}
            className="absolute z-10"
            style={{
              left: `${x}%`,
              top: `${y}%`,
              transform: 'translate(-50%, -50%)',
            }}
          >
            <OpponentHand
              player={opponent}
              isCurrentPlayer={game.players[game.currentPlayerIndex]?.id === opponent.id}
              position="top"
              onCardClick={(cardIndex) => handleOpponentCardClick(opponent.id, cardIndex)}
              highlightedCardIndex={null}
              powerUpHighlight={
                isMyTurn &&
                game.turnPhase === 'power_up' && 
                game.currentPowerUp && 
                (game.currentPowerUp.type === 'blind_swap' || 
                 game.currentPowerUp.type === 'inspect_swap' || 
                 game.currentPowerUp.type === 'inspect_other' ||
                 game.currentPowerUp.type === 'blind_swap_others' ||
                 game.currentPowerUp.type === 'inspect_swap_others')
                  ? 'selectable'
                  : undefined
              }
              powerUpSelectedIndex={
                // Use synced state for all players to see selection
                // Check if this opponent's card is selected as TARGET
                game.swapAnimation?.targetPlayerId === opponent.id 
                  ? game.swapAnimation.targetCardIndex ?? null
                  // Check if this opponent's card is selected as SECOND TARGET (for _others swaps)
                  : game.swapAnimation?.secondTargetPlayerId === opponent.id 
                    ? game.swapAnimation.secondTargetCardIndex ?? null
                    // Check if this opponent is the SOURCE player (their card selected for swap)
                    : game.swapAnimation?.sourcePlayerId === opponent.id && game.swapAnimation.sourceCardIndex !== undefined
                      ? game.swapAnimation.sourceCardIndex
                      // Fallback to local state
                      : (powerUpSwapAnim.opponentId === opponent.id 
                          ? powerUpSwapAnim.opponentCardIndex 
                          : powerUpSwapAnim.secondOpponentId === opponent.id 
                            ? powerUpSwapAnim.secondOpponentCardIndex 
                            : null)
              }
              powerUpConfirmed={
                // Use synced state for all players to see selection (any phase)
                // Show highlight during selecting, confirmed, animating, or revealing
                (game.swapAnimation?.targetPlayerId === opponent.id || 
                 game.swapAnimation?.secondTargetPlayerId === opponent.id ||
                 game.swapAnimation?.sourcePlayerId === opponent.id) ||
                ((powerUpSwapAnim.opponentId === opponent.id || powerUpSwapAnim.secondOpponentId === opponent.id) && 
                (powerUpSwapAnim.phase === 'selecting' || powerUpSwapAnim.phase === 'confirmed' || powerUpSwapAnim.phase === 'animating' || powerUpSwapAnim.phase === 'revealing'))
              }
              inspectingCardIndex={opponentInspectingIndex}
              isViewerInspecting={isMyTurn && game.currentPowerUp?.type === 'inspect_other' && game.inspectingCard?.playerId === opponent.id}
              revealingSwapCardIndex={
                // For inspect_swap (10) - reveal opponent's card
                (game.currentPowerUp?.type === 'inspect_swap' &&
                powerUpSwapAnim.phase === 'revealing' &&
                 powerUpSwapAnim.opponentId === opponent.id)
                  ? powerUpSwapAnim.opponentCardIndex
                // For inspect_swap_others (10 with 0 cards) - reveal both opponent cards
                : (game.currentPowerUp?.type === 'inspect_swap_others' &&
                   powerUpSwapAnim.phase === 'revealing' &&
                   (powerUpSwapAnim.opponentId === opponent.id || powerUpSwapAnim.secondOpponentId === opponent.id))
                  ? (powerUpSwapAnim.opponentId === opponent.id 
                      ? powerUpSwapAnim.opponentCardIndex 
                      : powerUpSwapAnim.secondOpponentCardIndex)
                  : null
              }
              isViewerRevealing={
                isMyTurn && 
                powerUpSwapAnim.phase === 'revealing' &&
                ((game.currentPowerUp?.type === 'inspect_swap' && powerUpSwapAnim.opponentId === opponent.id) ||
                 (game.currentPowerUp?.type === 'inspect_swap_others' && 
                  (powerUpSwapAnim.opponentId === opponent.id || powerUpSwapAnim.secondOpponentId === opponent.id)))
              }
              rotationAngle={rotationAngle}
              hiddenCardIndex={
                // Hide card during stack race (opponent's card being stacked)
                (() => {
                  // Check stack race first
                  if (game.stackRaceAnimation && game.stackRaceAnimation.phase !== 'completed') {
                    const opponentStack = game.stackRaceAnimation.stacks.find(s => 
                      s.targetPlayerId === opponent.id
                    );
                    if (opponentStack) return opponentStack.targetCardIndex ?? null;
                    // Also check if opponent is stacking their own card
                    const selfStack = game.stackRaceAnimation.stacks.find(s => 
                      s.playerId === opponent.id && !s.targetPlayerId
                    );
                    if (selfStack) return selfStack.playerCardIndex;
                  }
                  // Legacy stack animation
                  if (game.stackAnimation && 
                      game.stackAnimation.phase !== 'completed' &&
                      game.stackAnimation.stacks[0]?.targetPlayerId === opponent.id) {
                    return game.stackAnimation.stacks[0]?.targetCardIndex ?? null;
                  }
                  // NOTE: For power-up swap animations (9/10), we NO LONGER hide the cards
                  // Instead, they wiggle in place via isSwapAnimating prop
                // Hide card during give animation (target is receiving)
                  if (game.cardMoveAnimation?.type === 'give' && 
                      game.cardMoveAnimation.targetPlayerId === opponent.id) {
                    return game.cardMoveAnimation.targetHandIndex ?? null;
                  }
                // Hide card during swap animation for this opponent  
                  if (game.cardMoveAnimation?.type === 'swap' && 
                      game.cardMoveAnimation.playerId === opponent.id) {
                    return game.cardMoveAnimation.handIndex ?? null;
                  }
                  return null;
                })()
              }
              isSwapAnimating={game.swapAnimation?.phase === 'animating'}
            />
          </div>
        );
      })}

      {/* Center table area */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-16 z-10">
        {/* Deck */}
        <div 
          ref={deckRef}
          className="flex flex-col items-center gap-2"
        >
          <Deck
            count={game.deck.length}
            onClick={handleDeckClick}
            disabled={!allPlayersReady || !isMyTurn || game.turnPhase !== 'draw'}
            highlighted={false}
          />
          <span className="text-emerald-400 text-xs">Deck</span>
          
          {/* Show when opponent is drawing from deck */}
          <AnimatePresence>
            {!isMyTurn && game.drawnCard && game.lastAction.includes('deck') && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute -top-8 text-xs text-amber-400 font-medium whitespace-nowrap"
              >
                {currentPlayer?.name} drew ↑
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Discard pile */}
        <div 
          ref={discardRef}
          className="flex flex-col items-center gap-2 relative"
        >
          <DiscardPile
            cards={game.discardPile}
            onClick={handleDiscardClick}
            highlighted={false}
          />
          <span className="text-emerald-400 text-xs">Discard</span>
          
          {/* Stacking locked indicator */}
          {game.lastDiscardWasStack && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute -top-2 -right-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-bold shadow-lg"
            >
              🔒
            </motion.div>
          )}
          
          {/* Show when opponent is drawing from discard */}
          <AnimatePresence>
            {!isMyTurn && game.drawnCard && game.lastAction.includes('discard') && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="absolute -top-8 text-xs text-cyan-400 font-medium whitespace-nowrap"
              >
                {currentPlayer?.name} took ↑
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Drawn card animation - stays in place, enlarges 50% to simulate lifting */}
        <AnimatePresence mode="wait">
          {game.drawnCard && (
            <motion.div
              ref={drawnCardRef}
              key={game.drawnCard.id}
              initial={{ scale: 1, opacity: 0.8 }}
              animate={{ scale: 1.5, opacity: 1 }}
              exit={{ scale: 1, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              className="flex flex-col items-center gap-2"
            >
              <div className="relative">
                {/* Shadow underneath to show depth */}
                <motion.div 
                  className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-20 h-6 bg-black/40 rounded-full blur-lg"
                  animate={{ scale: [1, 1.1, 1], opacity: [0.4, 0.6, 0.4] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
                
                {/* Squeeze flip animation for deck draws */}
                {drawnCardSource === 'deck' && isMyTurn ? (
                  <div className="relative">
                    {/* Card back - squeezes out */}
                    <motion.div
                      initial={{ scaleX: 1, opacity: 1 }}
                      animate={{ scaleX: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: 'easeIn' }}
                      style={{ transformOrigin: 'center' }}
                      className="absolute inset-0"
                    >
                      <Card card={{ ...game.drawnCard, faceUp: false }} size="lg" />
                    </motion.div>
                    
                    {/* Card front - expands in */}
                    <motion.div
                      initial={{ scaleX: 0, opacity: 0 }}
                      animate={{ scaleX: 1, opacity: 1 }}
                      transition={{ duration: 0.25, ease: 'easeOut', delay: 0.25 }}
                      style={{ transformOrigin: 'center' }}
                    >
                      <Card card={game.drawnCard} size="lg" />
                    </motion.div>
                  </div>
                ) : (
                  /* No flip for discard draws or opponent view */
                  <Card 
                    card={isMyTurn ? game.drawnCard : { ...game.drawnCard, faceUp: false }} 
                    size="lg" 
                  />
                )}
                
                {/* Glow effect */}
                <motion.div
                  className="absolute inset-0 rounded-xl bg-amber-400/30 blur-xl -z-10"
                  animate={{ opacity: [0.3, 0.6, 0.3], scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity }}
                />
              </div>
              <motion.span 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
                className={`text-xs font-medium ${drawnCardSource === 'discard' && isMyTurn ? 'text-orange-400' : 'text-amber-400'}`}
              >
                {isMyTurn 
                  ? (drawnCardSource === 'deck' 
                      ? '🎴 From Deck' 
                      : '♻️ From Discard (must swap!)')
                  : `${currentPlayer?.name} is deciding...`
                }
              </motion.span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Card Movement Animation Overlay - shows sliding cards for all players */}
      <AnimatePresence>
        {cardMoveAnim.type === 'discard_drawn' && cardMoveAnim.drawnCard && cardMoveAnim.drawnPos && cardMoveAnim.discardPos && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-30"
          >
            {/* Card sliding from drawn position to discard pile - EXACT COORDINATES */}
            <motion.div
              initial={{ 
                position: 'fixed',
                left: cardMoveAnim.drawnPos.x - CARD_WIDTH / 2,
                top: cardMoveAnim.drawnPos.y - CARD_HEIGHT / 2,
                scale: 1.5,
              }}
              animate={{ 
                left: cardMoveAnim.discardPos.x - CARD_WIDTH / 2,
                top: cardMoveAnim.discardPos.y - CARD_HEIGHT / 2,
                scale: 1,
              }}
              transition={{ 
                type: 'spring', 
                stiffness: 120, 
                damping: 18,
              }}
              className="z-40"
            >
              <Card card={{ ...cardMoveAnim.drawnCard, faceUp: true }} size="lg" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Swap animation overlay - cards physically move on the table (SEQUENTIAL) with EXACT COORDINATES */}
      <AnimatePresence>
        {cardMoveAnim.type === 'swap_cards' && cardMoveAnim.drawnCard && cardMoveAnim.handCard && cardMoveAnim.handPos && cardMoveAnim.discardPos && cardMoveAnim.drawnPos && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-30"
          >
            {/* Subtle dark overlay */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.3 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black"
            />
            
            {/* STEP 1: Card going OUT to discard (old card from hand) - flip and move to discard - EXACT COORDS */}
            <motion.div
              initial={{ 
                position: 'fixed',
                left: cardMoveAnim.handPos.x - CARD_WIDTH / 2,
                top: cardMoveAnim.handPos.y - CARD_HEIGHT / 2,
                scale: 1,
                zIndex: 50,
              }}
              animate={{ 
                left: cardMoveAnim.discardPos.x - CARD_WIDTH / 2,
                top: cardMoveAnim.discardPos.y - CARD_HEIGHT / 2,
                scale: 1,
              }}
              transition={{ 
                type: 'spring', 
                stiffness: 120, 
                damping: 18,
                duration: 0.5,
              }}
              className="z-50"
            >
              {/* Squeeze flip animation */}
              <div className="relative w-20 h-28">
                {/* Card back squeezes out */}
                <motion.div
                  initial={{ scaleX: 1, opacity: 1 }}
                  animate={{ scaleX: 0, opacity: 0 }}
                  transition={{ duration: 0.15, ease: 'easeIn' }}
                  style={{ transformOrigin: 'center' }}
                  className="absolute inset-0"
                >
                  <Card card={{ ...cardMoveAnim.handCard, faceUp: false }} size="lg" />
                </motion.div>
                {/* Card front expands in */}
                <motion.div
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ duration: 0.15, ease: 'easeOut', delay: 0.15 }}
                  style={{ transformOrigin: 'center' }}
                >
                  <Card card={{ ...cardMoveAnim.handCard, faceUp: true }} size="lg" />
                </motion.div>
              </div>
            </motion.div>
            
            {/* STEP 2: Card coming IN to hand (drawn card) - moves to exact empty slot AFTER discard - EXACT COORDS */}
            <motion.div
              initial={{ 
                position: 'fixed',
                left: cardMoveAnim.drawnPos.x - CARD_WIDTH / 2,
                top: cardMoveAnim.drawnPos.y - CARD_HEIGHT / 2,
                scale: 1.5,
                opacity: 1,
              }}
              animate={{ 
                left: cardMoveAnim.handPos.x - CARD_WIDTH / 2,
                top: cardMoveAnim.handPos.y - CARD_HEIGHT / 2,
                scale: 1,
              }}
              transition={{ 
                type: 'spring', 
                stiffness: 120, 
                damping: 18,
                // Delay so this happens AFTER the discard animation
                delay: 0.6,
              }}
              className="z-40"
            >
              <Card card={cardMoveAnim.drawnCard} size="lg" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Card Movement Animation for OTHER PLAYERS - shows sliding cards */}
      <AnimatePresence>
        {game.cardMoveAnimation && (game.cardMoveAnimation.type === 'give' || game.cardMoveAnimation.playerId !== peerId) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 pointer-events-none z-30"
          >
            {/* Subtle overlay */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.2 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black"
            />
            
            {/* Player indicator */}
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="fixed top-4 left-1/2 -translate-x-1/2 z-50"
            >
              <div className="px-4 py-2 bg-amber-500/90 rounded-full font-bold text-white shadow-lg">
                {game.cardMoveAnimation.type === 'swap' && '🔄 '}
                {game.cardMoveAnimation.type === 'discard' && '🃏 '}
                {game.cardMoveAnimation.type === 'draw_deck' && '🎴 '}
                {game.cardMoveAnimation.type === 'draw_discard' && '↩️ '}
                {game.cardMoveAnimation.type === 'give' && '🎁 '}
                {game.cardMoveAnimation.playerName}
                {game.cardMoveAnimation.type === 'swap' && ' swapping...'}
                {game.cardMoveAnimation.type === 'discard' && ' discarding...'}
                {game.cardMoveAnimation.type === 'draw_deck' && ' drawing from deck...'}
                {game.cardMoveAnimation.type === 'draw_discard' && ' taking from discard...'}
                {game.cardMoveAnimation.type === 'give' && ' giving a card...'}
              </div>
            </motion.div>

            {/* For SWAP: Show card going to discard (face up) THEN card going to hand (face down) - SEQUENTIAL */}
            {game.cardMoveAnimation.type === 'swap' && game.cardMoveAnimation.discardedCard && (
              <>
                {/* STEP 1: Card going to discard pile - flips and moves */}
                <motion.div
                  initial={{ 
                    position: 'fixed',
                    // Start at opponent's hand position (they're at top of screen)
                    // Index 0,1 = bottom row (top for us), Index 2,3 = top row (farther up for us)
                    top: game.cardMoveAnimation.handIndex !== null && game.cardMoveAnimation.handIndex < 2 ? '25%' : '15%',
                    left: game.cardMoveAnimation.handIndex !== null ? 
                      `calc(50% + ${(game.cardMoveAnimation.handIndex % 2 === 0 ? -1 : 1) * 40}px)` : '50%',
                    x: '-50%',
                    scale: 1,
                    opacity: 1,
                  }}
                  animate={{ 
                    // Move to discard pile position
                    top: '50%',
                    left: '55%',
                    y: '-50%',
                    scale: 1,
                  }}
                  transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                  className="z-40"
                >
                  <div className="relative w-20 h-28">
                    <motion.div
                      initial={{ scaleX: 1 }}
                      animate={{ scaleX: 0 }}
                      transition={{ duration: 0.15, ease: 'easeIn' }}
                      style={{ transformOrigin: 'center' }}
                      className="absolute inset-0"
                    >
                      <Card card={{ ...game.cardMoveAnimation.discardedCard!, faceUp: false }} size="lg" />
                    </motion.div>
                    <motion.div
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1 }}
                      transition={{ duration: 0.15, ease: 'easeOut', delay: 0.15 }}
                      style={{ transformOrigin: 'center' }}
                    >
                      <Card card={{ ...game.cardMoveAnimation.discardedCard!, faceUp: true }} size="lg" />
                    </motion.div>
                  </div>
                </motion.div>

                {/* STEP 2: Card going to player's hand (face down) - moves AFTER discard */}
                <motion.div
                  initial={{ 
                    position: 'fixed',
                    // Start at center where drawn card was
                    top: '50%',
                    left: '50%',
                    x: '-50%',
                    y: '-50%',
                    scale: 1.3,
                  }}
                  animate={{ 
                    // Move to exact hand position (opponent is at top)
                    top: game.cardMoveAnimation.handIndex !== null && game.cardMoveAnimation.handIndex < 2 ? '25%' : '15%',
                    left: game.cardMoveAnimation.handIndex !== null ? 
                      `calc(50% + ${(game.cardMoveAnimation.handIndex % 2 === 0 ? -1 : 1) * 40}px)` : '50%',
                    x: '-50%',
                    y: '0%',
                    scale: 1,
                  }}
                  transition={{ type: 'spring', stiffness: 120, damping: 18, delay: 0.6 }}
                  className="z-40"
                >
                  <Card card={{ ...game.cardMoveAnimation.drawnCard!, faceUp: false }} size="lg" />
                </motion.div>
              </>
            )}

            {/* For DISCARD: Show drawn card sliding to discard pile */}
            {game.cardMoveAnimation.type === 'discard' && game.cardMoveAnimation.discardedCard && (
              <motion.div
                initial={{ 
                  position: 'fixed',
                  top: '50%',
                  left: '60%',
                  x: '-50%',
                  y: '-50%',
                  scale: 1.3,
                }}
                animate={{ 
                  left: '55%',
                  scale: 1,
                }}
                transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                className="z-40"
              >
                <Card card={{ ...game.cardMoveAnimation.discardedCard, faceUp: true }} size="lg" />
              </motion.div>
            )}

            {/* For DRAW from DISCARD: Show card lifting from discard */}
            {game.cardMoveAnimation.type === 'draw_discard' && game.cardMoveAnimation.drawnCard && (
              <motion.div
                initial={{ 
                  position: 'fixed',
                  top: '50%',
                  left: '55%',
                  x: '-50%',
                  y: '-50%',
                  scale: 1,
                }}
                animate={{ 
                  left: '60%',
                  scale: 1.3,
                }}
                transition={{ type: 'spring', stiffness: 120, damping: 18 }}
                className="z-40"
              >
                <Card card={{ ...game.cardMoveAnimation.drawnCard, faceUp: true }} size="lg" />
              </motion.div>
            )}

            {/* For GIVE: show card moving from stacker hand slot to target's emptied slot */}
            {game.cardMoveAnimation.type === 'give' &&
              game.cardMoveAnimation.drawnCard &&
              game.cardMoveAnimation.targetPlayerId &&
              game.cardMoveAnimation.targetHandIndex !== undefined && (
                (() => {
                  // Position calculation (approximate based on table layout), consistent with swap overlay
                  const myPosition = { x: '50%', y: '85%' };
                  const getOpponentPosition = (playerId: string) => {
                    const opponentIndex = opponents.findIndex(o => o.id === playerId);
                    const count = opponents.length;
                    if (count === 1) return { x: '50%', y: '15%' };
                    const angleStep = 360 / (count + 1);
                    const angle = (opponentIndex + 1) * angleStep - 90;
                    const radius = 35;
                    return {
                      x: `${50 + radius * Math.cos((angle * Math.PI) / 180)}%`,
                      y: `${50 + radius * Math.sin((angle * Math.PI) / 180)}%`,
                    };
                  };

                  const stackerPosBase =
                    game.cardMoveAnimation.playerId === peerId ? myPosition : getOpponentPosition(game.cardMoveAnimation.playerId);
                  const targetPosBase =
                    game.cardMoveAnimation.targetPlayerId === peerId ? myPosition : getOpponentPosition(game.cardMoveAnimation.targetPlayerId);

                  const idxFrom = game.cardMoveAnimation.handIndex ?? 0;
                  const idxTo = game.cardMoveAnimation.targetHandIndex ?? 0;

                  const offsetForIndex = (idx: number, isBottom: boolean) => {
                    // 2x2 grid offsets relative to player position
                    const col = idx % 2;
                    const row = idx < 2 ? 0 : 1;
                    const x = (col === 0 ? -1 : 1) * 40;
                    const y = row === 0 ? (isBottom ? -28 : 28) : (isBottom ? 28 : -28);
                    return { x, y };
                  };

                  const fromIsBottom = game.cardMoveAnimation.playerId === peerId;
                  const toIsBottom = game.cardMoveAnimation.targetPlayerId === peerId;
                  const fromOff = offsetForIndex(idxFrom, fromIsBottom);
                  const toOff = offsetForIndex(idxTo, toIsBottom);

                  return (
                    <motion.div
                      initial={{
                        position: 'fixed',
                        left: stackerPosBase.x,
                        top: stackerPosBase.y,
                        x: fromOff.x,
                        y: fromOff.y,
                        scale: 1.3,
                        opacity: 1,
                      }}
                      animate={{
                        left: [stackerPosBase.x, '50%', targetPosBase.x],
                        top: [stackerPosBase.y, '50%', targetPosBase.y],
                        x: [fromOff.x, 0, toOff.x],
                        y: [fromOff.y, 0, toOff.y],
                        scale: [1.3, 1.3, 1],
                      }}
                      transition={{
                        duration: 1.2,
                        ease: 'easeInOut',
                        times: [0, 0.5, 1],
                      }}
                      className="z-50"
                    >
                      <Card card={{ ...game.cardMoveAnimation.drawnCard, faceUp: false }} size="lg" />
                    </motion.div>
                  );
                })()
              )}
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Quick action indicator (non-blocking, subtle) */}
      <AnimatePresence>
        {actionAnnouncement && !swapAnimation && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.2 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-40 pointer-events-none"
          >
            <div className={`
              px-4 py-2 rounded-full font-bold text-sm text-white shadow-lg
              ${actionAnnouncement.type === 'swap' ? 'bg-amber-500/90' : ''}
              ${actionAnnouncement.type === 'stack' ? 'bg-purple-500/90' : ''}
              ${actionAnnouncement.type === 'discard' ? 'bg-rose-500/90' : ''}
              ${actionAnnouncement.type === 'draw' ? 'bg-cyan-500/90' : ''}
            `}>
              {actionAnnouncement.type === 'swap' && '🔄'}
              {actionAnnouncement.type === 'stack' && '⚡'}
              {actionAnnouncement.type === 'discard' && '🃏'}
              {actionAnnouncement.type === 'draw' && '🎴'}
              {' '}{actionAnnouncement.playerName}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

        </motion.div>
        {/* End of pannable container */}
      </div>
      {/* End of scrollable game area */}

      {/* Fixed bottom bar - Player's hand and action buttons */}
      <div className={`fixed bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-emerald-950/95 via-emerald-950/80 to-transparent ${isMobile ? 'pb-2 pt-6' : 'pb-4 pt-8'}`}>
      {/* My hand at bottom */}
      {myPlayer && (
          <div ref={myHandRef} className={`flex justify-center overflow-visible ${isMobile ? 'mb-1' : 'mb-2'}`}>
          <PlayerHand
            player={myPlayer}
            isCurrentPlayer={isMyTurn}
            isMyHand={true}
            selectedCardIndex={selectedCardIndex}
            onCardClick={handleMyCardClick}
            showBottomCards={isViewingMyCards}
            position="bottom"
            powerUpHighlight={
              // Highlight for card give selection after stacking opponent (check both legacy and race)
              ((game.stackAnimation?.result?.awaitingCardGive && game.stackAnimation.result.stackerId === peerId) ||
               (game.stackRaceAnimation?.awaitingCardGive && game.stackRaceAnimation.winnerId === peerId))
                ? 'selectable'
                : (game.turnPhase === 'power_up' && 
                   game.currentPowerUp && 
                   (game.currentPowerUp.type === 'blind_swap' || 
                    game.currentPowerUp.type === 'inspect_swap' || 
                    game.currentPowerUp.type === 'inspect_own')
                    ? 'selectable'
                    : undefined)
            }
            powerUpSelectedIndex={
              // Use synced state for all players to see selection
              game.swapAnimation?.sourcePlayerId === peerId && game.swapAnimation?.sourceCardIndex !== undefined
                ? game.swapAnimation.sourceCardIndex
                : powerUpSwapAnim.myCardIndex
            }
            powerUpConfirmed={
              // Use synced state for all players to see confirmed selection
              (game.swapAnimation?.sourcePlayerId === peerId && game.swapAnimation?.sourceCardIndex !== undefined) ||
              (powerUpSwapAnim.phase === 'confirmed' || powerUpSwapAnim.phase === 'animating' || powerUpSwapAnim.phase === 'revealing')
            }
            inspectingCardIndex={game.inspectingCard?.playerId === peerId ? game.inspectingCard.cardIndex : null}
            isInspectingMyCard={isMyTurn && game.currentPowerUp?.type === 'inspect_own'}
            revealingSwapCardIndex={
              game.currentPowerUp?.type === 'inspect_swap' && 
              powerUpSwapAnim.phase === 'revealing' && 
              isMyTurn
                ? powerUpSwapAnim.myCardIndex 
                : null
            }
            hiddenCardIndex={
              // Hide card during stack race animation (my card being stacked)
              (() => {
                // Check stack race first
                if (game.stackRaceAnimation && game.stackRaceAnimation.phase !== 'completed') {
                  const myStack = game.stackRaceAnimation.stacks.find(s => 
                    s.playerId === peerId && !s.targetPlayerId
                  );
                  if (myStack) return myStack.playerCardIndex;
                }
                // Legacy stack animation
                if (game.stackAnimation && 
                    game.stackAnimation.phase !== 'completed' &&
                    game.stackAnimation.stacks[0]?.playerId === peerId &&
                    !game.stackAnimation.stacks[0]?.targetPlayerId) {
                  return game.stackAnimation.stacks[0]?.playerCardIndex ?? null;
                }
                // NOTE: For power-up swap animations (9/10), we NO LONGER hide the cards
                // Instead, they wiggle in place via isSwapAnimating prop
              // Hide card during regular swap animation (my card being swapped out)
                if (cardMoveAnim.type === 'swap_cards') return cardMoveAnim.handIndex;
              // Hide card during give animation (I'm giving a card)
                if (game.cardMoveAnimation?.type === 'give' && 
                    game.cardMoveAnimation.playerId === peerId) {
                  return game.cardMoveAnimation.handIndex ?? null;
                }
                return null;
              })()
            }
            isSwapAnimating={game.swapAnimation?.phase === 'animating'}
          />
        </div>
      )}

        {/* Action buttons - positioned next to hand */}
        <div className={`flex justify-center items-center gap-3 ${isMobile ? 'mt-1' : 'mt-2'}`}>
        {game.phase === 'viewing_cards' && isViewingMyCards && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleReadyClick}
              className={`bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl transition-shadow ${isMobile ? 'px-6 py-3 text-base' : 'px-8 py-4 text-lg'}`}
          >
            Ready!
          </motion.button>
        )}

        {allPlayersReady && (game.phase === 'playing' || game.phase === 'final_round') && (
          <motion.button
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            whileHover={isMyTurn && game.turnPhase === 'draw' && !game.redsCallerId ? { scale: 1.05 } : {}}
            whileTap={isMyTurn && game.turnPhase === 'draw' && !game.redsCallerId ? { scale: 0.95 } : {}}
            onClick={handleCallReds}
            disabled={!isMyTurn || game.turnPhase !== 'draw' || !!game.redsCallerId}
              className={`font-semibold rounded-lg shadow-md transition-all ${isMobile ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'} ${
              isMyTurn && game.turnPhase === 'draw' && !game.redsCallerId
                ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white hover:shadow-lg cursor-pointer'
                : game.redsCallerId
                  ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed line-through'
                  : 'bg-gray-600/50 text-gray-400 cursor-not-allowed'
            }`}
          >
            {game.redsCallerId ? 'REDS Called!' : 'REDS!'}
          </motion.button>
        )}
        </div>
      </div>

      {/* Subtle "give a card" prompt (no background dim) */}
      <AnimatePresence>
        {((game.stackAnimation?.result?.awaitingCardGive && game.stackAnimation.result.stackerId === peerId) ||
          (game.stackRaceAnimation?.awaitingCardGive && game.stackRaceAnimation.winnerId === peerId)) && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-16 left-4 z-40 pointer-events-none"
          >
            <div className="px-3 py-2 rounded-xl bg-black/40 backdrop-blur text-white text-sm font-semibold shadow-lg border border-white/10">
              Give a card: <span className="text-amber-300">click any card in your hand</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Non-blocking Skip Power-Up button on the side */}
      <AnimatePresence>
        {game.turnPhase === 'power_up' && game.currentPowerUp && isMyTurn && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="fixed right-4 bottom-1/3 z-30"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={skipPowerUp}
              className="px-4 py-2 bg-gray-700/90 hover:bg-gray-600 text-white font-semibold rounded-lg text-sm transition-colors shadow-lg"
            >
              Skip ⏭️
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Power-up swap reveal - cards stay in place with highlighting */}
      
      {/* Power-up notification toast (non-blocking) */}
      <AnimatePresence>
        {powerUpNotification && (
          <motion.div
            initial={{ opacity: 0, y: -20, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -20, x: '-50%' }}
            className="fixed top-4 left-1/2 z-50 pointer-events-none"
          >
            <div className={`
              px-4 py-2 rounded-lg font-semibold text-white shadow-lg flex items-center gap-2
              ${powerUpNotification.action === 'used' 
                ? 'bg-gradient-to-r from-amber-500 to-orange-500' 
                : 'bg-gradient-to-r from-gray-500 to-gray-600'
              }
            `}>
              {powerUpNotification.action === 'used' ? (
                <>
                  <span className="text-lg">
                    {powerUpNotification.powerUpType === 'inspect_own' && '👁️'}
                    {powerUpNotification.powerUpType === 'inspect_other' && '🔍'}
                    {powerUpNotification.powerUpType === 'blind_swap' && '🔀'}
                    {powerUpNotification.powerUpType === 'inspect_swap' && '👀🔀'}
                    {powerUpNotification.powerUpType === 'blind_swap_others' && '🔀🔀'}
                    {powerUpNotification.powerUpType === 'inspect_swap_others' && '👀🔀🔀'}
                  </span>
                  <span>{powerUpNotification.playerName} used power-up!</span>
                </>
              ) : (
                <>
                  <span className="text-lg">⏭️</span>
                  <span>{powerUpNotification.playerName} skipped power-up</span>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PROMINENT REDS CALL NOTIFICATION - Full screen overlay */}
      <AnimatePresence>
        {redsNotification && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none"
          >
            {/* Background pulse effect */}
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ 
                scale: [1, 1.1, 1],
                opacity: [0.3, 0.5, 0.3]
              }}
              transition={{ 
                duration: 1.5,
                repeat: 2,
                ease: "easeInOut"
              }}
              className="absolute inset-0 bg-gradient-to-br from-red-600/30 to-rose-600/30"
            />
            
            {/* Main notification card */}
            <motion.div
              initial={{ scale: 0.5, y: 50, rotateX: -20 }}
              animate={{ 
                scale: 1, 
                y: 0, 
                rotateX: 0,
              }}
              transition={{ 
                type: "spring",
                stiffness: 200,
                damping: 15
              }}
              className="relative bg-gradient-to-br from-red-600 to-rose-700 rounded-3xl p-8 shadow-2xl shadow-red-500/50 border-4 border-red-400"
            >
              {/* Animated glow */}
              <motion.div
                animate={{ 
                  boxShadow: [
                    '0 0 30px 10px rgba(239, 68, 68, 0.4)',
                    '0 0 60px 20px rgba(239, 68, 68, 0.6)',
                    '0 0 30px 10px rgba(239, 68, 68, 0.4)'
                  ]
                }}
                transition={{ duration: 1, repeat: Infinity }}
                className="absolute inset-0 rounded-3xl"
              />
              
              <div className="relative z-10 text-center">
                {/* Big REDS text */}
                <motion.div
                  animate={{ scale: [1, 1.1, 1] }}
                  transition={{ duration: 0.5, repeat: 3 }}
                  className="text-6xl sm:text-7xl md:text-8xl font-black text-white mb-2 drop-shadow-lg"
                  style={{ textShadow: '0 0 30px rgba(255,255,255,0.5)' }}
                >
                  🚨 REDS! 🚨
                </motion.div>
                
                {/* Player name */}
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                  className="text-2xl sm:text-3xl font-bold text-red-100 mb-4"
                >
                  {redsNotification.isMe ? 'You called' : `${redsNotification.playerName} called`} REDS!
                </motion.p>
                
                {/* Final round message */}
                <motion.p
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 }}
                  className="text-lg sm:text-xl text-red-200 font-medium"
                >
                  ⚡ Everyone else gets ONE final turn! ⚡
                </motion.p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      
      {/* Floating Swap/Keep buttons for inspect_swap (10) - appears when both cards selected */}
      <AnimatePresence>
        {game.currentPowerUp?.type === 'inspect_swap' && 
         powerUpSwapAnim.myCardIndex !== null && 
         powerUpSwapAnim.opponentCardIndex !== null &&
         powerUpSwapAnim.phase === 'revealing' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50 flex gap-4"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                // Execute swap with animation - pass myCardIndex as sourceCardIndex
                if (powerUpSwapAnim.opponentId && powerUpSwapAnim.opponentCardIndex !== null && powerUpSwapAnim.myCardIndex !== null) {
                  // Start the swap animation so all players see the cards moving
                  startSwapAnimation('inspect_swap', powerUpSwapAnim.opponentId, powerUpSwapAnim.opponentCardIndex, powerUpSwapAnim.myCardIndex);
                  
                  // Complete the swap after animation plays
                  setTimeout(() => {
                    completePowerUp(powerUpSwapAnim.opponentId!, powerUpSwapAnim.opponentCardIndex!, powerUpSwapAnim.myCardIndex!);
                    clearSwapAnimation();
                  }, ANIMATION_TIMING.swap);
                }
                setPowerUpSwapAnim({
                  myCardIndex: null,
                  opponentId: null,
                  opponentCardIndex: null,
                  secondOpponentId: null,
                  secondOpponentCardIndex: null,
                  myCard: null,
                  opponentCard: null,
                  phase: 'idle',
                });
              }}
              className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl text-lg shadow-lg shadow-green-500/30"
            >
              ✓ Swap Cards
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                // Keep cards - don't swap
                completePowerUp();
                setPowerUpSwapAnim({
                  myCardIndex: null,
                  opponentId: null,
                  opponentCardIndex: null,
                  secondOpponentId: null,
                  secondOpponentCardIndex: null,
                  myCard: null,
                  opponentCard: null,
                  phase: 'idle',
                });
              }}
              className="px-6 py-3 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-bold rounded-xl text-lg shadow-lg shadow-gray-500/30"
            >
              ✗ Keep My Card
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Floating Swap/Keep buttons for inspect_swap_others (10 with 0 cards) */}
      <AnimatePresence>
        {game.currentPowerUp?.type === 'inspect_swap_others' && 
         powerUpSwapAnim.opponentCardIndex !== null && 
         powerUpSwapAnim.secondOpponentCardIndex !== null &&
         powerUpSwapAnim.phase === 'revealing' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-32 left-1/2 -translate-x-1/2 z-50 flex gap-4"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                // Execute swap between opponents with animation
                if (powerUpSwapAnim.opponentId && powerUpSwapAnim.opponentCardIndex !== null &&
                    powerUpSwapAnim.secondOpponentId && powerUpSwapAnim.secondOpponentCardIndex !== null) {
                  // Start the swap animation so all players see the cards moving
                  startSwapAnimation(
                    'inspect_swap_others', 
                    powerUpSwapAnim.opponentId, 
                    powerUpSwapAnim.opponentCardIndex, 
                    undefined,
                    powerUpSwapAnim.secondOpponentId, 
                    powerUpSwapAnim.secondOpponentCardIndex
                  );
                  
                  // Complete the swap after animation plays
                  setTimeout(() => {
                    completePowerUp(
                      powerUpSwapAnim.opponentId!, 
                      powerUpSwapAnim.opponentCardIndex!, 
                      undefined,
                      powerUpSwapAnim.secondOpponentId!, 
                      powerUpSwapAnim.secondOpponentCardIndex!
                    );
                    clearSwapAnimation();
                  }, ANIMATION_TIMING.swap);
                }
                setPowerUpSwapAnim({
                  myCardIndex: null,
                  opponentId: null,
                  opponentCardIndex: null,
                  secondOpponentId: null,
                  secondOpponentCardIndex: null,
                  myCard: null,
                  opponentCard: null,
                  secondOpponentCard: null,
                  phase: 'idle',
                });
              }}
              className="px-6 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white font-bold rounded-xl text-lg shadow-lg shadow-green-500/30"
            >
              ✓ Swap Their Cards
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                // Don't swap - just complete
                completePowerUp();
                setPowerUpSwapAnim({
                  myCardIndex: null,
                  opponentId: null,
                  opponentCardIndex: null,
                  secondOpponentId: null,
                  secondOpponentCardIndex: null,
                  myCard: null,
                  opponentCard: null,
                  secondOpponentCard: null,
                  phase: 'idle',
                });
              }}
              className="px-6 py-3 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-bold rounded-xl text-lg shadow-lg shadow-gray-500/30"
            >
              ✗ Don't Swap
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Power-Up Swap Animation Overlay - visible to all players via synced game state */}
      {/* Shows a "SWAP!" banner - the actual card wiggle is handled by PlayerHand/OpponentHand */}
      <AnimatePresence>
        {game.swapAnimation && game.swapAnimation.phase === 'animating' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 pointer-events-none flex items-center justify-center"
          >
            {/* Swap notification banner */}
            <motion.div 
              initial={{ scale: 0.5, opacity: 0, y: -20 }}
              animate={{ 
                scale: [0.5, 1.2, 1],
                opacity: 1,
                y: 0,
                rotate: [0, -5, 5, -3, 3, 0]
              }}
              exit={{ scale: 0.5, opacity: 0, y: 20 }}
              transition={{ 
                duration: 0.6,
                rotate: { duration: 0.5, delay: 0.2 }
              }}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 px-8 py-4 rounded-2xl shadow-2xl shadow-emerald-500/50 border-4 border-emerald-300"
            >
              <div className="flex items-center gap-4">
                <motion.span 
                  animate={{ rotate: [0, 20, -20, 0] }}
                  transition={{ duration: 0.5, repeat: 2 }}
                  className="text-4xl"
                >
                  🔀
                </motion.span>
                <div className="text-center">
                  <motion.div 
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 0.3, repeat: 3 }}
                    className="text-3xl sm:text-4xl font-black text-white drop-shadow-lg"
                  >
                    SWAP!
                  </motion.div>
                  <div className="text-emerald-100 text-sm font-medium mt-1">
              {(() => {
                const isOthersSwap = game.swapAnimation.type === 'blind_swap_others' || game.swapAnimation.type === 'inspect_swap_others';
                const sourceName = isOthersSwap
                  ? game.players.find(p => p.id === game.swapAnimation?.targetPlayerId)?.name
                  : game.players.find(p => p.id === game.swapAnimation?.sourcePlayerId)?.name || game.swapAnimation.playerName;
                const targetName = isOthersSwap
                  ? game.players.find(p => p.id === game.swapAnimation?.secondTargetPlayerId)?.name
                  : game.players.find(p => p.id === game.swapAnimation?.targetPlayerId)?.name;
                      return `${sourceName} ↔ ${targetName}`;
                    })()}
                      </div>
                      </div>
                <motion.span 
                  animate={{ rotate: [0, -20, 20, 0] }}
                  transition={{ duration: 0.5, repeat: 2 }}
                  className="text-4xl"
                >
                  🔀
                </motion.span>
            </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stack Animation Overlay - Point-to-Point Animation */}
      {/* Animation sequence:
          1. Card disappears from original spot (handled by hiddenCardIndex)
          2. Card value (face UP) appears at original spot and flies to discard
          3. If valid stack - card stays at discard
          4. If invalid - card flies back to original spot, then reappears as face-down
      */}
      <AnimatePresence>
        {game.stackAnimation && game.stackAnimation.stacks.length > 0 && (() => {
          const stack = game.stackAnimation.stacks[0];
          const sourcePos = game.stackAnimation.sourcePosition || { x: window.innerWidth / 2, y: window.innerHeight };
          const rawDiscardPos = game.stackAnimation.discardPosition || cardPositions.discardPosition;
          // Normalize discard position - handle both { x: number, y: number } and PositionWithPixels types
          const discardPos = {
            x: 'xPx' in rawDiscardPos ? rawDiscardPos.xPx : (typeof rawDiscardPos.x === 'number' ? rawDiscardPos.x : parseFloat(rawDiscardPos.x)),
            y: 'yPx' in rawDiscardPos ? rawDiscardPos.yPx : (typeof rawDiscardPos.y === 'number' ? rawDiscardPos.y : parseFloat(rawDiscardPos.y)),
          };
          const phase = game.stackAnimation.phase;
          const result = game.stackAnimation.result;
          
          // Don't show overlay when awaiting card give - let player interact with their hand
          if (result?.awaitingCardGive) return null;
          
          // Determine current position based on phase
          // flying_to_discard: start at source, animate to discard
          // showing_result: stay at discard (success) or start flying back (failure)
          // flying_back: animate from discard back to source
          const isAtSource = phase === 'flying_to_discard';
          const isAtDiscard = phase === 'showing_result' && result?.success;
          const isFlyingBack = phase === 'flying_back' || (phase === 'showing_result' && result?.success === false);
          
          // Card offset for centering (half of card dimensions)
          const cardOffsetX = 40;
          const cardOffsetY = 56;
          
          return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
              className={`fixed inset-0 z-40 pointer-events-none ${
                isFlyingBack ? 'bg-black/40' : 'bg-black/60'
            }`}
          >
              {/* Flying card - ALWAYS face up (value exposed) */}
              <motion.div
                initial={{ 
                  x: sourcePos.x - cardOffsetX,
                  y: sourcePos.y - cardOffsetY,
                  scale: 1,
                  rotate: 0,
                }}
                animate={{ 
                  x: isFlyingBack ? sourcePos.x - cardOffsetX : discardPos.x - cardOffsetX,
                  y: isFlyingBack ? sourcePos.y - cardOffsetY : discardPos.y - cardOffsetY,
                  scale: phase === 'flying_to_discard' ? [1, 1.15, 1.1] : isFlyingBack ? 1 : 1.1,
                  rotate: phase === 'flying_to_discard' ? [0, -3, 3, 0] : 0,
                }}
                transition={{ 
                  duration: isFlyingBack ? 0.5 : 0.6,
                  ease: isFlyingBack ? 'easeIn' : 'easeOut',
                }}
                className="absolute pointer-events-auto"
                style={{ zIndex: 100 }}
              >
                <div className="relative">
                  {/* Card - ALWAYS face up during animation */}
                <motion.div
                    initial={{ opacity: 1 }}
                    animate={{ 
                      opacity: 1,
                    }}
                  style={{ transformOrigin: 'center' }}
                  >
                    <div className={`rounded-xl transition-all duration-300 ${
                      phase === 'flying_to_discard' 
                        ? 'ring-4 ring-yellow-400 shadow-[0_0_30px_rgba(250,204,21,0.8)]' 
                        : result?.success 
                          ? 'ring-4 ring-green-400 shadow-[0_0_30px_rgba(34,197,94,0.8)]' 
                          : result?.success === false 
                            ? 'ring-4 ring-red-500 shadow-[0_0_30px_rgba(239,68,68,0.8)]' 
                            : ''
                    }`}>
                  <Card 
                        card={{ ...stack.card, faceUp: true }} 
                    size="lg"
                  />
                    </div>
                </motion.div>
                
                {/* Player name badge */}
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="absolute -bottom-8 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap bg-emerald-600 text-white shadow-lg"
                >
                    {stack.playerName}
                </motion.div>
                </div>
              </motion.div>
              
              {/* Result indicator - centered overlay */}
              <AnimatePresence>
                {result && phase !== 'flying_to_discard' && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.2 }}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                  >
                    {result.success ? (
                      <div className="flex flex-col items-center gap-2 bg-black/50 px-8 py-6 rounded-2xl backdrop-blur-sm">
                        <motion.div 
                          className="text-7xl sm:text-8xl text-green-500 font-black drop-shadow-lg"
                          animate={{ scale: [1, 1.2, 1] }}
                          transition={{ duration: 0.5 }}
                        >
                          ✓
                        </motion.div>
                        <span className="text-xl sm:text-2xl font-bold text-green-400">SUCCESS!</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-2 bg-black/50 px-8 py-6 rounded-2xl backdrop-blur-sm">
                        <motion.div 
                          className="text-7xl sm:text-8xl text-red-500 font-black drop-shadow-lg"
                          animate={{ scale: [1, 1.2, 1], rotate: [0, -5, 5, 0] }}
                          transition={{ duration: 0.5 }}
                        >
                          ✗
                        </motion.div>
                        <span className="text-xl sm:text-2xl font-bold text-red-400">MISSTACK!</span>
                        <span className="text-xs sm:text-sm text-red-300">Drawing penalty card...</span>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
              
              {/* "STACKING..." text while flying */}
              {phase === 'flying_to_discard' && !result && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  className="absolute top-1/4 left-1/2 -translate-x-1/2 pointer-events-none"
                >
                  <span className="text-4xl sm:text-5xl font-black text-yellow-400 drop-shadow-lg tracking-wider">
                    STACKING...
                  </span>
                </motion.div>
              )}
          </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Trigger stack resolution after flip animation */}
      {game.stackAnimation && !game.stackAnimation.result && (
        <StackAnimationResolver />
      )}

      {/* Clear stack animation after showing result */}
      {game.stackAnimation?.result && !game.stackAnimation.result.awaitingCardGive && (
        <StackAnimationClearer />
      )}

      {/* Stack Race Animation - Multiple players stacking simultaneously */}
      {game.stackRaceAnimation && game.stackRaceAnimation.phase === 'collecting' && (
        <StackRaceResolver />
      )}
      {game.stackRaceAnimation && game.stackRaceAnimation.phase === 'resolving' && !game.stackRaceAnimation.awaitingCardGive && (
        <StackRaceClearer />
      )}
      
      <AnimatePresence>
        {game.stackRaceAnimation && game.stackRaceAnimation.stacks.length > 0 && (() => {
          const race = game.stackRaceAnimation;
          const discardPos = race.discardPosition || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          const isResolved = race.phase === 'resolving';
          const isAwaitingGive = race.awaitingCardGive;
          const cardOffsetX = 40;
          const cardOffsetY = 56;
          
          // Don't show overlay when awaiting card give - let player interact with their hand
          if (isAwaitingGive) return null;
          
          return (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 pointer-events-none bg-black/60"
            >
              {/* Multiple flying cards */}
              {race.stacks.map((stack, stackIndex) => {
                const result = race.results[stack.playerId];
                const sourcePos = stack.sourcePosition || { x: window.innerWidth / 2, y: window.innerHeight };
                
                // Determine animation phase
                const isWinner = isResolved && result?.isWinner;
                const isMisstack = isResolved && result && !result.success; // Wrong card
                const isTooSlow = isResolved && result && result.success && !result.isWinner; // Right card but too slow
                const shouldFlyBack = isResolved && !isWinner; // All non-winners fly back
                
                // Stagger positions at discard pile to show stack order
                const stackOffset = stackIndex * 8;
                
                return (
            <motion.div
                    key={`${stack.playerId}-${stack.timestamp}`}
                    initial={{ 
                      x: sourcePos.x - cardOffsetX,
                      y: sourcePos.y - cardOffsetY,
                      scale: 1,
                      rotate: 0,
                    }}
                    animate={{ 
                      x: shouldFlyBack 
                        ? sourcePos.x - cardOffsetX 
                        : discardPos.x - cardOffsetX + stackOffset,
                      y: shouldFlyBack 
                        ? sourcePos.y - cardOffsetY 
                        : discardPos.y - cardOffsetY + stackOffset,
                      scale: isResolved ? (isWinner ? 1.15 : 1) : 1.1,
                      rotate: isResolved ? 0 : [0, -3, 3, 0],
                      zIndex: isWinner ? 100 : 50 - stackIndex,
                    }}
                    transition={{ 
                      duration: shouldFlyBack ? 0.5 : 0.6,
                      ease: shouldFlyBack ? 'easeIn' : 'easeOut',
                      delay: stackIndex * 0.05, // Stagger by timestamp order
                    }}
                    className="absolute pointer-events-auto"
                    style={{ zIndex: isWinner ? 100 : 50 - stackIndex }}
                  >
                    <div className="relative">
              <motion.div
                        animate={{ 
                          opacity: shouldFlyBack ? [1, 1, 0.8] : 1,
                        }}
                        transition={{ duration: 0.3, delay: shouldFlyBack ? 0.5 : 0 }}
                      >
                        <div className={`rounded-xl transition-all duration-300 ${
                          !isResolved
                            ? 'ring-4 ring-yellow-400 shadow-[0_0_30px_rgba(250,204,21,0.8)]' 
                            : isWinner 
                              ? 'ring-4 ring-green-400 shadow-[0_0_30px_rgba(34,197,94,0.8)]' 
                              : isMisstack
                                ? 'ring-4 ring-red-500 shadow-[0_0_30px_rgba(239,68,68,0.8)]'
                                : isTooSlow
                                  ? 'ring-4 ring-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.6)]' // Too slow - amber/yellow
                                  : 'ring-4 ring-gray-400'
                        }`}>
                          <Card 
                            card={{ ...stack.card, faceUp: true }} 
                            size="lg"
                          />
                </div>
              </motion.div>
              
                      {/* Player name badge */}
              <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.1 + stackIndex * 0.05 }}
                        className={`absolute -bottom-8 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap shadow-lg ${
                          isWinner 
                            ? 'bg-green-600 text-white' 
                            : isMisstack 
                              ? 'bg-red-600 text-white' 
                              : isTooSlow 
                                ? 'bg-amber-500 text-amber-950' // Too slow - no penalty
                                : 'bg-emerald-600 text-white'
                        }`}
                      >
                        {stack.playerName}
                        {isWinner && ' 🏆'}
                        {isMisstack && ' ❌ +1'}
                        {isTooSlow && ' ⏱️'}
                      </motion.div>
                      
                      {/* Timestamp indicator (subtle) */}
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.6 }}
                        className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] text-white/60 font-mono"
                      >
                        #{stackIndex + 1}
                      </motion.div>
                    </div>
                  </motion.div>
                );
              })}
              
              {/* Race status text */}
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0, opacity: 0 }}
                className="absolute top-1/4 left-1/2 -translate-x-1/2 pointer-events-none"
              >
                <span className={`text-4xl sm:text-5xl font-black drop-shadow-lg tracking-wider ${
                  !isResolved 
                    ? 'text-yellow-400' 
                    : race.winnerId 
                      ? 'text-green-400' 
                      : 'text-red-400'
                }`}>
                  {!isResolved 
                    ? `STACK RACE! (${race.stacks.length} player${race.stacks.length > 1 ? 's' : ''})` 
                    : race.winnerId 
                      ? `${race.stacks.find(s => s.playerId === race.winnerId)?.playerName} STACKED!`
                      : 'ALL MISSTACKS!'
                  }
                </span>
              </motion.div>
              
              {/* Result indicators */}
              {isResolved && (
                <motion.div
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.5 }}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                >
                  {race.winnerId ? (
                    <div className="flex flex-col items-center gap-2 bg-black/50 px-8 py-6 rounded-2xl backdrop-blur-sm">
                      <motion.div 
                        className="text-7xl sm:text-8xl text-green-500 font-black drop-shadow-lg"
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 0.5 }}
                      >
                        ✓
                      </motion.div>
                      <span className="text-xl sm:text-2xl font-bold text-green-400">STACK SUCCESS!</span>
                      {race.stacks.length > 1 && (
                        <span className="text-sm text-green-300">
                          {race.stacks.find(s => s.playerId === race.winnerId)?.playerName} was fastest!
                        </span>
                      )}
                      {/* Show who else had the right card but was too slow */}
                      {(() => {
                        const tooSlowPlayers = race.stacks.filter(s => 
                          race.results[s.playerId]?.success && !race.results[s.playerId]?.isWinner
                        );
                        if (tooSlowPlayers.length > 0) {
                          return (
                            <span className="text-xs text-amber-300 mt-1">
                              {tooSlowPlayers.map(s => s.playerName).join(', ')} had it too but were slower
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2 bg-black/50 px-8 py-6 rounded-2xl backdrop-blur-sm">
                      <motion.div 
                        className="text-7xl sm:text-8xl text-red-500 font-black drop-shadow-lg"
                        animate={{ scale: [1, 1.2, 1], rotate: [0, -5, 5, 0] }}
                        transition={{ duration: 0.5 }}
                      >
                        ✗
                      </motion.div>
                      <span className="text-xl sm:text-2xl font-bold text-red-400">
                        {race.stacks.length > 1 ? 'ALL MISSTACKS!' : 'MISSTACK!'}
                      </span>
                      <span className="text-xs sm:text-sm text-red-300">
                        {race.stacks.filter(s => !race.results[s.playerId]?.success).length > 0 
                          ? 'Wrong card = penalty card!' 
                          : 'Drawing penalty cards...'}
                      </span>
                    </div>
                  )}
                </motion.div>
              )}
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Penalty Card Animation - shows face-down card flying from deck to player */}
      <AnimatePresence>
        {game.penaltyCardDisplay && (() => {
          // Find the target player's position for the animation
          const targetPlayerId = game.penaltyCardDisplay.playerId;
          const targetPlayerIndex = game.players.findIndex(p => p.id === targetPlayerId);
          const isMyPenalty = targetPlayerId === peerId;
          
          // Get deck position
          const deckPos = cardPositions.deckPosition;
          
          // Get target position (player's hand)
          let targetPos = { x: window.innerWidth / 2, y: window.innerHeight - 100 };
          if (isMyPenalty) {
            // My hand is at the bottom
            targetPos = { x: window.innerWidth / 2, y: window.innerHeight - 80 };
          } else if (targetPlayerIndex >= 0) {
            // Opponent's position
            const oppPos = cardPositions.getPlayerCardPosition(targetPlayerIndex, 0);
            if (oppPos) {
              targetPos = { x: oppPos.xPx, y: oppPos.yPx };
            }
          }
          
          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 pointer-events-none"
            >
              {/* Semi-transparent backdrop */}
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.5 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 bg-black"
              />
              
              {/* Flying face-down card from deck to player */}
                <motion.div
                initial={{ 
                  x: deckPos.xPx - 40,
                  y: deckPos.yPx - 56,
                  scale: 1,
                  rotate: 0,
                }}
                  animate={{ 
                  x: targetPos.x - 40,
                  y: targetPos.y - 56,
                  scale: [1, 1.2, 0.8],
                  rotate: [0, -10, 10, 0],
                }}
                transition={{ 
                  duration: 0.8,
                  ease: 'easeInOut',
                }}
                className="absolute"
                style={{ zIndex: 100 }}
              >
                <div className="relative">
                  {/* Face-down card with red glow */}
                  <div className="rounded-xl ring-4 ring-red-500 shadow-[0_0_30px_rgba(239,68,68,0.8)]">
                    <Card 
                      card={{ ...game.penaltyCardDisplay.card, faceUp: false }} 
                      size="lg"
                    />
                  </div>
                  
                  {/* "PENALTY" label */}
              <motion.div
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.2 }}
                    className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded-full whitespace-nowrap"
                  >
                    +1 PENALTY
                  </motion.div>
                </div>
              </motion.div>

              {/* Player name indicator */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
                className="absolute top-1/4 left-1/2 -translate-x-1/2 text-center"
              >
                <div className="text-red-400 text-xl font-bold">
                  {game.penaltyCardDisplay.playerName} draws penalty card
                </div>
                <div className="text-gray-400 text-sm mt-1">
                  (Card value is hidden)
                </div>
            </motion.div>
          </motion.div>
          );
        })()}
      </AnimatePresence>
      
      {/* Auto-clear penalty animation */}
      {game.penaltyCardDisplay && <PenaltyAnimationClearer />}

      {/* Game over overlay - can be closed to inspect final hands */}
      <AnimatePresence>
        {game.phase === 'game_over' && showGameOverPanel && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/80 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0, rotate: -5 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 20 }}
              className="bg-gradient-to-br from-emerald-800 to-emerald-900 p-8 rounded-2xl shadow-2xl max-w-lg w-full mx-4 relative"
            >
              {/* X button to close and inspect hands */}
              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={() => setShowGameOverPanel(false)}
                className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-colors"
                title="Close to inspect final hands"
              >
                ✕
              </motion.button>
              
              <motion.h2 
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-3xl font-bold text-center text-amber-400 mb-6"
              >
                Game Over!
              </motion.h2>
              
              <div className="space-y-4">
                {game.players
                  .map(p => ({
                    ...p,
                    score: p.cards.reduce((sum, c) => sum + (c.faceUp ? 
                      (c.rank === 'JOKER' ? 0 :
                       c.rank === 'A' ? 1 : 
                       c.rank === 'J' ? 11 : 
                       c.rank === 'Q' ? 12 : 
                       c.rank === 'K' ? (c.suit === 'hearts' || c.suit === 'diamonds' ? -2 : 13) : 
                       parseInt(c.rank)) : 0), 0),
                  }))
                  .sort((a, b) => a.score - b.score)
                  .map((player, idx) => (
                    <motion.div
                      key={player.id}
                      initial={{ x: -50, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: 0.3 + idx * 0.1 }}
                      className={`
                        flex items-center justify-between p-4 rounded-xl
                        ${idx === 0 ? 'bg-amber-500/30 ring-2 ring-amber-400' : 'bg-white/10'}
                      `}
                    >
                      <div className="flex items-center gap-3">
                        <motion.span 
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ delay: 0.4 + idx * 0.1, type: 'spring' }}
                          className={`
                            w-8 h-8 rounded-full flex items-center justify-center font-bold
                            ${idx === 0 ? 'bg-amber-500 text-amber-950' : 'bg-emerald-700 text-emerald-200'}
                          `}
                        >
                          {idx + 1}
                        </motion.span>
                        <span className="text-white font-medium">
                          {player.name}
                          {player.hasCalledReds && <span className="ml-2 text-red-400">(Called Reds)</span>}
                        </span>
                      </div>
                      <motion.span 
                        initial={{ scale: 0 }}
                        animate={{ scale: 1 }}
                        transition={{ delay: 0.5 + idx * 0.1, type: 'spring' }}
                        className={`text-2xl font-bold ${idx === 0 ? 'text-amber-400' : 'text-emerald-300'}`}
                      >
                        {player.score}
                      </motion.span>
                    </motion.div>
                  ))}
              </div>

              <p className="text-center text-emerald-300/70 text-sm mt-4">
                Click ✕ to close and inspect all players' hands
              </p>

              <motion.button
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.8 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => window.location.reload()}
                className="w-full mt-4 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded-xl shadow-lg"
              >
                Play Again
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Button to reopen score panel after closing */}
      {game.phase === 'game_over' && !showGameOverPanel && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setShowGameOverPanel(true)}
          className="fixed bottom-8 right-8 z-50 px-6 py-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-bold rounded-xl shadow-lg"
        >
          Show Scores / Play Again
        </motion.button>
      )}
      
      {/* Mobile pan indicator - shows when table is pannable */}
      {isMobile && tableScale > 1 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: isPanning ? 0 : 1, y: 0 }}
          transition={{ delay: 1 }}
          className="fixed bottom-36 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 bg-black/60 backdrop-blur-sm rounded-full text-white/80 text-xs flex items-center gap-2 pointer-events-none"
        >
          <span className="text-base">👆</span>
          <span>Drag to pan table</span>
        </motion.div>
      )}
      
      {/* Reset pan button for mobile */}
      {isMobile && (panPosition.x !== 0 || panPosition.y !== 0) && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          whileTap={{ scale: 0.9 }}
          onClick={() => {
            setPanPosition({ x: 0, y: 0 });
            lastPanRef.current = { x: 0, y: 0 };
          }}
          className="fixed top-14 right-2 z-50 px-2 py-1 bg-black/50 backdrop-blur-sm rounded-full text-white/80 text-xs flex items-center gap-1"
        >
          <span>⟲</span>
          <span>Center</span>
        </motion.button>
      )}
    </div>
  );
}
