package com.campusforge.backend.deck;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.UuidGenerator;

import java.util.UUID;

@Entity
@Table(name = "formats")
public class Format {

    @Id
    @GeneratedValue
    @UuidGenerator
    @Column(columnDefinition = "UUID")
    private UUID id;

    @Column(nullable = false, unique = true)
    private String code;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false)
    private int maxCopies;

    @Column(nullable = false)
    private int minDeckSize;

    private Integer maxDeckSize;

    @Column(nullable = false)
    private boolean commanderRequired;

    @Column(nullable = false)
    private boolean basicsUnlimited;

    public Format() {
    }

    public Format(String code, String name, int maxCopies, int minDeckSize,
                  Integer maxDeckSize, boolean commanderRequired, boolean basicsUnlimited) {
        this.code = code;
        this.name = name;
        this.maxCopies = maxCopies;
        this.minDeckSize = minDeckSize;
        this.maxDeckSize = maxDeckSize;
        this.commanderRequired = commanderRequired;
        this.basicsUnlimited = basicsUnlimited;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getCode() {
        return code;
    }

    public void setCode(String code) {
        this.code = code;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public int getMaxCopies() {
        return maxCopies;
    }

    public void setMaxCopies(int maxCopies) {
        this.maxCopies = maxCopies;
    }

    public int getMinDeckSize() {
        return minDeckSize;
    }

    public void setMinDeckSize(int minDeckSize) {
        this.minDeckSize = minDeckSize;
    }

    public Integer getMaxDeckSize() {
        return maxDeckSize;
    }

    public void setMaxDeckSize(Integer maxDeckSize) {
        this.maxDeckSize = maxDeckSize;
    }

    public boolean isCommanderRequired() {
        return commanderRequired;
    }

    public void setCommanderRequired(boolean commanderRequired) {
        this.commanderRequired = commanderRequired;
    }

    public boolean isBasicsUnlimited() {
        return basicsUnlimited;
    }

    public void setBasicsUnlimited(boolean basicsUnlimited) {
        this.basicsUnlimited = basicsUnlimited;
    }
}
