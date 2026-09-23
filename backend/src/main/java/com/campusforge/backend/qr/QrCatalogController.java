package com.campusforge.backend.qr;

import com.campusforge.backend.qr.dto.QrPrintEntry;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/admin/qr-catalog")
public class QrCatalogController {

    private final ClaimService claimService;
    private final QrCatalogExporter exporter;

    public QrCatalogController(ClaimService claimService, QrCatalogExporter exporter) {
        this.claimService = claimService;
        this.exporter = exporter;
    }

    @GetMapping
    public ResponseEntity<?> getCatalog(@RequestParam(defaultValue = "json") String format) {
        List<QrPrintEntry> entries = claimService.generatePrintCatalog();

        if ("csv".equalsIgnoreCase(format)) {
            StringBuilder csv = new StringBuilder();
            csv.append("cardName,oracleId,tokenCore,fullToken,ownershipType,rarity\n");
            for (QrPrintEntry e : entries) {
                csv.append(QrCatalogExporter.csvEscape(e.cardName())).append(',')
                   .append(QrCatalogExporter.csvEscape(e.oracleId())).append(',')
                   .append(e.tokenCore()).append(',')
                   .append(e.fullToken()).append(',')
                   .append(e.ownershipType()).append(',')
                   .append(QrCatalogExporter.csvEscape(e.rarity())).append('\n');
            }
            return ResponseEntity.ok()
                    .contentType(MediaType.TEXT_PLAIN)
                    .body(csv.toString());
        }

        return ResponseEntity.ok(entries);
    }

    @PostMapping("/regenerate")
    public ResponseEntity<?> regenerate() throws IOException {
        List<QrPrintEntry> entries = exporter.export();
        return ResponseEntity.ok(Map.of(
                "cards", entries.size(),
                "dir", "qr-catalog"
        ));
    }
}
