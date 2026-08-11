# Phase 1: Forge Headless & Engine Extraction

## Objective
Fork Forge, strip the Java Swing UI layer, establish a headless execution mode, and confirm that matches can be simulated programmatically.

## Detailed Tasks
1. **Repository Setup & Fork**
   - Fork or clone `https://github.com/Card-Forge/forge.git` into `forge-engine/`.
   - Analyze Maven/Gradle build configuration (`pom.xml` / `build.gradle`).
2. **UI Decoupling**
   - Identify Swing dependencies (`javax.swing`, `java.awt`, UI controllers, views).
   - Isolate the rules engine (`forge-game`, `forge-core`, `forge-ai`) from UI modules (`forge-gui-desktop`).
   - Create a headless runner main class or entry point that instantiates a match between two decks programmatically.
3. **Headless Execution Verification**
   - Write a test harness (JUnit or standalone main) that starts a game, executes turns (or runs AI vs AI), and logs game state changes.
   - Verify card database assets (`carddb.zip` / script files) load correctly without a graphical display context.
4. **State Adapter API Definition**
   - Design the interface between the headless Forge process and the external backend (e.g., standard input/output, local TCP socket, or gRPC).
   - Define event emissions for:
     - Game start
     - Phase / Step changes
     - Priority passes
     - Life total changes
     - Zone updates (Hand, Battlefield, Graveyard, Library, Stack)
     - Game over / Winner declaration
