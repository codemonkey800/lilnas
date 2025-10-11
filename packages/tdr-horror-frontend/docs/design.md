# 🎮 Horror Game Design Doc

_Last Updated: [Date]_
_Status: Pre-Alpha_

## 📋 Quick Reference (The Only Page That Matters)

### Core Loop (30 seconds)

1. Spawn in dark forest with friends
2. Monster starts hunting after 60 seconds
3. Find cabin while avoiding monster
4. Everyone must reach cabin to win

### Controls

- **WASD** - Move
- **SHIFT** - Sprint (8 seconds stamina)
- **CTRL** - Crouch (quieter, slower)
- **F** - Flashlight toggle
- **E** - Interact/Pickup
- **V** - Voice chat (proximity-based)
- **TAB** - See objectives

### Current Build Focus

- [ ] Basic movement working at 60fps
- [ ] Flashlight creates tension
- [ ] Monster is scary but fair
- [ ] Voice chat works reliably
- [ ] One complete playable round

---

## 🎯 Design Pillars (Don't Violate These)

1. **Fear through vulnerability** - No weapons, only escape
2. **Better together** - Solo is possible but terrifying
3. **Performance first** - 60fps > pretty graphics
4. **Immediate fun** - Playable in 5 minutes, no tutorials needed

---

## 📊 Key Numbers (Tune These)

| System              | Value      | Why                           |
| ------------------- | ---------- | ----------------------------- |
| Player walk speed   | 5 m/s      | Feels natural                 |
| Player sprint speed | 8 m/s      | Fast but not ridiculous       |
| Monster walk speed  | 4 m/s      | Slower than player walk       |
| Monster run speed   | 7 m/s      | Catchable if player exhausted |
| Stamina duration    | 8 seconds  | Creates tension               |
| Stamina recharge    | 4 seconds  | Forces strategic sprinting    |
| Flashlight battery  | 5 minutes  | Must conserve                 |
| Voice chat range    | 20 meters  | Close enough to group         |
| Map size            | 500x500m   | 3-5 minute rounds             |
| Monster spawn delay | 60 seconds | Time to spread out            |

---

## 🧟 Monster Behavior States

```
DORMANT (first 60s)
  ↓
PATROLLING (no players detected)
  ↓ [sees/hears player]
INVESTIGATING (moving to last known position)
  ↓ [sees player]
CHASING (direct pursuit)
  ↓ [loses sight for 10s]
SEARCHING (checking hiding spots)
  ↓ [30s pass]
PATROLLING
```

**Current AI Rules:**

- Can't see through walls
- 45° vision cone, 30m range
- Hears running at 15m, walking at 8m
- Remembers last 3 seen positions
- Checks common hiding spots when searching

---

## 🗺️ Map Elements

### Must Have (MVP)

- [ ] Dense trees for breaking line of sight
- [ ] 1 cabin (the goal)
- [ ] 3-5 landmarks for navigation
- [ ] 5-10 hiding spots (bushes, logs)

### Nice to Have (Post-MVP)

- [ ] Multiple cabins (only one is real)
- [ ] Underground cave system
- [ ] Abandoned vehicles
- [ ] River that slows movement

---

## 🎮 Playtesting Feedback Log

### Session 1 - [Date]

**Players:** [Names]
**What worked:**

- **What didn't:**

- **Changes made:**

- ***

## 🐛 Known Issues

1. **[CRITICAL]** Monster can see through trees sometimes
2. **[HIGH]** Stamina doesn't recharge while crouching
3. **[LOW]** Footsteps too quiet

---

## 🚀 Implementation Order

### Week 1: Foundation ✅

- [ ] Basic scene with trees
- [ ] First person movement
- [ ] Flashlight
- [ ] Win condition (reach cabin)

### Week 2: Core Game

- [ ] Monster spawns and follows player
- [ ] Stamina system
- [ ] Basic hiding mechanic
- [ ] Death/restart

### Week 3: Multiplayer

- [ ] Server setup
- [ ] Player sync
- [ ] Shared monster state
- [ ] Basic lobby

### Week 4: Polish

- [ ] Voice chat
- [ ] Sound effects
- [ ] Better monster AI
- [ ] Performance optimization

---

## 💡 Ideas Parking Lot (Don't Build Yet)

- Different monster types
- Procedural map generation
- Collectible lore notes
- Multiple escape routes
- Power-ups (temporary speed boost)
- Weather effects
- Sanity system
- Spectator mode with flying camera
- Monster can mimic player voices in voice chat
- Footprints in mud

---

## 📝 Decisions Made

- **Why no combat?** Creates helplessness, forces cooperation
- **Why 8 players max?** Voice chat chaos, performance limits
- **Why one monster?** Easier to balance, more predictable
- **Why fixed map?** Players can learn and strategize
- **Why proximity voice?** Splitting up has consequences

---

## 🎨 Visual Reference

**Mood:** The Forest, Phasmophobia, Blair Witch
**Lighting:** Harsh flashlight shadows, minimal ambient
**Color Palette:** Desaturated blues/grays, bright white flashlight
**Monster:** Tall, humanoid but wrong, jerky movement
