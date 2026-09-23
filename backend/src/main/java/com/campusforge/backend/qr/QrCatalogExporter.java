package com.campusforge.backend.qr;

import com.campusforge.backend.qr.dto.QrPrintEntry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

@Component
public class QrCatalogExporter implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(QrCatalogExporter.class);

    private final ClaimService claimService;

    @Value("${campusforge.qr.catalog-dir:qr-catalog}")
    private Path catalogDir;

    public QrCatalogExporter(ClaimService claimService) {
        this.claimService = claimService;
    }

    @Override
    public void run(ApplicationArguments args) throws IOException {
        export();
    }

    public List<QrPrintEntry> export() throws IOException {
        List<QrPrintEntry> entries = claimService.generatePrintCatalog();
        Files.createDirectories(catalogDir);

        Files.writeString(catalogDir.resolve("cards.json"), toJson(entries), StandardCharsets.UTF_8);
        Files.writeString(catalogDir.resolve("cards.csv"), toCsv(entries), StandardCharsets.UTF_8);

        log.info("QR catalog exported: {} cards -> {}", entries.size(), catalogDir.toAbsolutePath());
        return entries;
    }

    private static String toJson(List<QrPrintEntry> entries) {
        StringBuilder sb = new StringBuilder("[\n");
        for (int i = 0; i < entries.size(); i++) {
            QrPrintEntry e = entries.get(i);
            sb.append("  {\"cardName\":\"").append(esc(e.cardName()))
              .append("\",\"oracleId\":\"").append(esc(e.oracleId()))
              .append("\",\"tokenCore\":\"").append(e.tokenCore())
              .append("\",\"fullToken\":\"").append(e.fullToken())
              .append("\",\"ownershipType\":\"").append(e.ownershipType())
              .append("\",\"rarity\":\"").append(esc(e.rarity()))
              .append("\"}");
            if (i < entries.size() - 1) sb.append(',');
            sb.append('\n');
        }
        sb.append("]\n");
        return sb.toString();
    }

    private static String toCsv(List<QrPrintEntry> entries) {
        StringBuilder sb = new StringBuilder();
        sb.append("cardName,oracleId,tokenCore,fullToken,ownershipType,rarity\n");
        for (QrPrintEntry e : entries) {
            sb.append(csvEscape(e.cardName())).append(',')
              .append(csvEscape(e.oracleId())).append(',')
              .append(e.tokenCore()).append(',')
              .append(e.fullToken()).append(',')
              .append(e.ownershipType()).append(',')
              .append(csvEscape(e.rarity())).append('\n');
        }
        return sb.toString();
    }

    private static String esc(String s) {
        return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"");
    }

    static String csvEscape(String value) {
        if (value == null) return "";
        if (value.contains(",") || value.contains("\"") || value.contains("\n")) {
            return "\"" + value.replace("\"", "\"\"") + "\"";
        }
        return value;
    }
}
