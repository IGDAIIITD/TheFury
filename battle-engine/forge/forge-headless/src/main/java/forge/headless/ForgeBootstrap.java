package forge.headless;

import forge.CardStorageReader;
import forge.StaticData;
import forge.card.CardType;
import forge.util.FileSection;
import forge.util.FileUtil;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.Map;

/**
 * Initializes Forge's {@link StaticData} (card database, editions, tokens) without any GUI.
 *
 * <p>The card data lives under the stripped GUI module's resource folder, so the location is
 * configurable via the {@value #RES_DIR_PROP} system property. Defaults to {@value #DEFAULT_RES_DIR}
 * relative to the working directory (the forge-engine checkout).</p>
 */
public final class ForgeBootstrap {
    public static final String RES_DIR_PROP = "forge.res.dir";
    public static final String DEFAULT_RES_DIR = "forge-gui/res";
    public static final String ALT_RES_DIR = "../forge-gui/res";
    public static final String BACKEND_RES_DIR = "../forge-engine/forge-gui/res";

    private static boolean initialized;

    private ForgeBootstrap() {}

    public static synchronized void init() {
        if (initialized) {
            return;
        }

        String resDir = System.getProperty(RES_DIR_PROP);
        Path res;
        if (resDir != null) {
            res = resolveResDir(resDir);
        } else {
            res = firstExisting(DEFAULT_RES_DIR, ALT_RES_DIR, BACKEND_RES_DIR);
        }

        Path cardsFolder = res.resolve("cardsfolder");
        Path tokenFolder = res.resolve("tokenscripts");
        Path editionFolder = res.resolve("editions");
        Path blockDataFolder = res.resolve("blockdata");
        Path setLookupFolder = res.resolve("setlookup");
        Path languagesFolder = res.resolve("languages");

        if (!Files.isDirectory(cardsFolder)) {
            throw new IllegalStateException("Forge card data not found at " + cardsFolder);
        }

        forge.util.Localizer.getInstance().initialize("en-US", languagesFolder.toString());
        forge.util.Lang.createInstance("en-US");
        initImageKeys();
        loadTypeLists(res);

        String customEditionsFolder = createTempDir().toString();

        CardStorageReader cardReader = new CardStorageReader(cardsFolder.toString(), null, false);
        CardStorageReader tokenReader = new CardStorageReader(tokenFolder.toString(), null, false);

        new StaticData(cardReader, tokenReader, null, null,
                editionFolder.toString(), customEditionsFolder,
                blockDataFolder.toString(), setLookupFolder.toString(),
                "", false, false, false, false);

        initialized = true;
    }

    /**
     * Loads the base card type lists (basic lands, creature types, ...) from
     * {@code res/lists/TypeLists.txt}. These populate {@link CardType.Constant}
     * before any card rules are parsed, otherwise {@code CardType.sanisfySubtypes()}
     * strips every subtype (e.g. "Forest") because the type tables are empty, which
     * in turn removes the mana abilities basic lands rely on.
     */
    private static void loadTypeLists(Path res) {
        Path lists = res.resolve("lists").resolve("TypeLists.txt");
        if (!Files.isRegularFile(lists)) {
            return;
        }
        Map<String, List<String>> sections = FileSection.parseSections(FileUtil.readFile(lists.toFile()));
        for (Map.Entry<String, List<String>> section : sections.entrySet()) {
            String name = section.getKey();
            if (name.endsWith("Types")) {
                CardType.Helper.parseTypes(name, section.getValue());
            }
        }
    }

    private static Path resolveResDir(String resDir) {
        Path path = Paths.get(resDir);
        if (!Files.isDirectory(path)) {
            throw new IllegalStateException("Forge resource dir not found: " + path.toAbsolutePath());
        }
        return path;
    }

    private static Path firstExisting(String... candidates) {
        for (String candidate : candidates) {
            Path path = Paths.get(candidate);
            if (Files.isDirectory(path)) {
                return path;
            }
        }
        throw new IllegalStateException("Forge resource dir not found. Set -D" + RES_DIR_PROP
                + " or run from the forge-engine checkout. Tried: " + String.join(", ", candidates));
    }

    private static Path createTempDir() {
        try {
            Path dir = Files.createTempDirectory("forge-headless-editions");
            dir.toFile().deleteOnExit();
            return dir;
        } catch (IOException e) {
            throw new IllegalStateException("Could not create temp dir for custom editions", e);
        }
    }

    /**
     * Headless mode never renders card art, so image dirs are just empty temp
     * folders. {@link forge.ImageKeys} requires non-null paths before card
     * queries can run.
     */
    private static void initImageKeys() {
        Path base = createTempDir();
        Path cards = base.resolve("cards");
        Path tokens = base.resolve("tokens");
        Path icons = base.resolve("icons");
        Path boosters = base.resolve("boosters");
        Path fatPacks = base.resolve("fatpacks");
        Path boosterBoxes = base.resolve("boosterboxes");
        Path precons = base.resolve("precons");
        Path tournamentPacks = base.resolve("tournamentpacks");

        forge.ImageKeys.initializeDirs(
                cards.toString(), java.util.Collections.emptyMap(),
                tokens.toString(), icons.toString(), boosters.toString(),
                fatPacks.toString(), boosterBoxes.toString(),
                precons.toString(), tournamentPacks.toString());
    }
}
