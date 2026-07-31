// Answer list for the daily word puzzle (arcade/DailyWord.tsx).
//
// WHY A CURATED LIST RATHER THAN A REAL DICTIONARY: a full word list means
// shipping (or downloading) a dictionary file, and this panel's whole size
// argument right now is that a game should cost kilobytes. ~500 common words
// is ~4 KB, needs no download, and carries no licensing question at all.
//
// This file is the ANSWER list only. GUESSES ARE VALIDATED, against the much
// larger public-domain list in `guessWords.ts` (added later, on request --
// without it anyone could type gibberish until the letters fell out). Keep the
// two separate: an answer has to be common and satisfying, a guess only has to
// be a real word. Every word here must exist in guessWords.ts, or its day is
// unwinnable -- re-check that if you add one.
//
// SELECTION RULES used when curating: exactly five letters, no proper nouns,
// no plurals-of-a-4-letter-word (they make for unsatisfying answers), nothing
// obscure enough to feel unfair, and nothing anyone would rather not see on a
// work machine. Order is treated as arbitrary -- see `puzzleForDay`, which
// strides the list with a coprime multiplier so consecutive days aren't
// alphabetical neighbours.
//
// Length is asserted at module load in DEV only (see DailyWord.tsx) so a
// mistyped 4- or 6-letter entry can't silently become an unwinnable day.
export const WORDS: string[] = [
    "about", "above", "abuse", "actor", "acute", "admit", "adopt", "adult", "after", "again",
    "agent", "agree", "ahead", "alarm", "album", "alert", "alike", "alive", "allow", "alone",
    "along", "alter", "among", "anger", "angle", "angry", "apart", "apple", "apply", "arena",
    "argue", "arise", "array", "aside", "asset", "audio", "audit", "avoid", "awake", "award",
    "aware", "badly", "baker", "basic", "beach", "began", "begin", "being", "below", "bench",
    "birth", "black", "blame", "blank", "blast", "blend", "blind", "block", "blood", "bloom",
    "board", "boost", "booth", "bound", "brain", "brand", "brass", "brave", "bread", "break",
    "breed", "brick", "brief", "bring", "broad", "broke", "brown", "brush", "build", "built",
    "bunch", "buyer", "cabin", "cable", "cache", "canal", "candy", "cargo", "carry", "carve",
    "catch", "cause", "chain", "chair", "chalk", "charm", "chart", "chase", "cheap", "check",
    "cheek", "cheer", "chess", "chest", "chief", "child", "chill", "choir", "chose", "civic",
    "civil", "claim", "class", "clean", "clear", "clerk", "click", "cliff", "climb", "clock",
    "close", "cloth", "cloud", "coach", "coast", "could", "count", "court", "cover", "crack",
    "craft", "crash", "crazy", "cream", "crime", "cross", "crowd", "crown", "crude", "curve",
    "cycle", "daily", "dance", "dated", "dealt", "death", "debut", "decay", "delay", "dense",
    "depth", "doing", "doubt", "dozen", "draft", "drama", "drank", "dream", "dress", "dried",
    "drink", "drive", "drove", "dying", "eager", "early", "earth", "eight", "elder", "elect",
    "empty", "enemy", "enjoy", "enter", "entry", "equal", "error", "essay", "event", "every",
    "exact", "exist", "extra", "faith", "false", "fault", "feast", "fence", "ferry", "fever",
    "fiber", "field", "fifth", "fifty", "fight", "final", "first", "flame", "flash", "fleet",
    "flesh", "float", "flood", "floor", "flour", "fluid", "focus", "force", "forge", "forth",
    "forty", "forum", "found", "frame", "fraud", "fresh", "front", "frost", "fruit", "fully",
    "funny", "gauge", "ghost", "giant", "given", "glass", "globe", "glory", "glove", "going",
    "grace", "grade", "grain", "grand", "grant", "grape", "graph", "grasp", "grass", "grave",
    "great", "green", "greet", "grief", "grill", "gross", "group", "grown", "guard", "guess",
    "guest", "guide", "habit", "happy", "harsh", "haste", "hasty", "heart", "heavy", "hedge",
    "hello", "hence", "hobby", "honey", "honor", "horse", "hotel", "house", "human", "humor",
    "hurry", "ideal", "image", "imply", "index", "inner", "input", "irony", "issue", "ivory",
    "jelly", "jewel", "joint", "judge", "juice", "knife", "knock", "known", "label", "labor",
    "large", "laser", "later", "laugh", "layer", "learn", "lease", "least", "leave", "legal",
    "lemon", "level", "light", "limit", "linen", "liver", "lobby", "local", "lodge", "logic",
    "loose", "lorry", "lower", "loyal", "lucky", "lunar", "lunch", "magic", "major", "maker",
    "march", "match", "maybe", "mayor", "meant", "medal", "media", "mercy", "merge", "merit",
    "metal", "meter", "midst", "might", "minor", "minus", "mixed", "model", "moist", "money",
    "month", "moral", "motor", "mount", "mouse", "mouth", "movie", "music", "naked", "nasty",
    "naval", "nerve", "never", "newly", "night", "noble", "noise", "north", "noted", "novel",
    "nurse", "occur", "ocean", "offer", "often", "onion", "order", "other", "ought", "outer",
    "owner", "paint", "panel", "panic", "paper", "party", "pasta", "patch", "pause", "peace",
    "peach", "pearl", "pedal", "penny", "phase", "phone", "photo", "piano", "piece", "pilot",
    "pitch", "pizza", "place", "plain", "plane", "plant", "plate", "plaza", "point", "polar",
    "porch", "pound", "power", "press", "price", "pride", "prime", "print", "prior", "prize",
    "proof", "proud", "prove", "pulse", "punch", "pupil", "purse", "queen", "query", "quest",
    "queue", "quick", "quiet", "quite", "quota", "radar", "radio", "raise", "rally", "ranch",
    "range", "rapid", "ratio", "reach", "react", "ready", "realm", "rebel", "refer", "relax",
    "relay", "renew", "repay", "reply", "rider", "ridge", "rifle", "right", "rigid", "rival",
    "river", "roast", "robot", "rocky", "rough", "round", "route", "royal", "rugby", "ruler",
    "rural", "sadly", "safer", "saint", "salad", "sauce", "scale", "scene", "scope", "score",
    "scout", "screw", "sense", "serve", "seven", "shade", "shaft", "shake", "shall", "shame",
    "shape", "share", "sharp", "sheep", "sheet", "shelf", "shell", "shift", "shine", "shirt",
    "shock", "shoot", "shore", "short", "shown", "sight", "silly", "since", "sixth", "sixty",
    "skill", "sleep", "slice", "slide", "slope", "small", "smart", "smell", "smile", "smoke",
    "snake", "solar", "solid", "solve", "sorry", "sound", "south", "space", "spare", "speak",
    "speed", "spend", "spent", "spice", "spine", "spite", "split", "spoke", "sport", "spray",
    "squad", "staff", "stage", "stair", "stake", "stamp", "stand", "stare", "start", "state",
    "steal", "steam", "steel", "steep", "steer", "stick", "stiff", "still", "stock", "stone",
    "stood", "store", "storm", "story", "stove", "strip", "study", "stuff", "style", "sugar",
    "suite", "sunny", "super", "surge", "sweet", "swift", "swing", "sword", "table", "taken",
    "taste", "teach", "teeth", "tempo", "tenth", "thank", "theft", "their", "theme", "there",
    "these", "thick", "thing", "think", "third", "those", "three", "threw", "throw", "thumb",
    "tiger", "tight", "timer", "tired", "title", "toast", "today", "token", "tooth", "topic",
    "total", "touch", "tough", "towel", "tower", "trace", "track", "trade", "trail", "train",
    "trait", "treat", "trend", "trial", "tribe", "trick", "tried", "troop", "truck", "truly",
    "trunk", "trust", "truth", "tulip", "twice", "twist", "uncle", "under", "union", "unite",
    "unity", "until", "upper", "upset", "urban", "usage", "usual", "valid", "value", "valve",
    "vapor", "vault", "venue", "verse", "video", "virus", "visit", "vital", "vivid", "vocal",
    "voice", "voter", "wagon", "waste", "watch", "water", "weary", "weigh", "weird", "whale",
    "wheat", "wheel", "where", "which", "while", "white", "whole", "whose", "widen", "wider",
    "width", "woman", "world", "worry", "worse", "worst", "worth", "would", "wound", "wrist",
    "write", "wrong", "yield", "young", "yours", "youth", "zebra",
];
