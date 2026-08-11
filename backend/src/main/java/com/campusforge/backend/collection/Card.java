package com.campusforge.backend.collection;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.UuidGenerator;

import java.util.UUID;

@Entity
@Table(name = "cards")
public class Card {

    @Id
    @GeneratedValue
    @UuidGenerator
    @Column(columnDefinition = "UUID")
    private UUID id;

    @Column(nullable = false, unique = true)
    private String oracleId;

    @Column(nullable = false)
    private String forgeName;

    private String rarity;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private OwnershipType ownershipType;

    private String setCode;

    private Integer manaValue;

    private String types;

    private String colors;

    private String imageUrl;

    @Column(nullable = false)
    private boolean discoverable = true;

    @Column(name = "commander_eligible", nullable = false)
    private boolean commanderEligible = false;

    private String spawnRegion;

    private Double weight;

    public Card() {
    }

    public Card(String oracleId, String forgeName, String rarity, OwnershipType ownershipType,
                String setCode, Integer manaValue, String types, String colors, String imageUrl,
                boolean discoverable, String spawnRegion, Double weight) {
        this.oracleId = oracleId;
        this.forgeName = forgeName;
        this.rarity = rarity;
        this.ownershipType = ownershipType;
        this.setCode = setCode;
        this.manaValue = manaValue;
        this.types = types;
        this.colors = colors;
        this.imageUrl = imageUrl;
        this.discoverable = discoverable;
        this.spawnRegion = spawnRegion;
        this.weight = weight;
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getOracleId() {
        return oracleId;
    }

    public void setOracleId(String oracleId) {
        this.oracleId = oracleId;
    }

    public String getForgeName() {
        return forgeName;
    }

    public void setForgeName(String forgeName) {
        this.forgeName = forgeName;
    }

    public String getRarity() {
        return rarity;
    }

    public void setRarity(String rarity) {
        this.rarity = rarity;
    }

    public OwnershipType getOwnershipType() {
        return ownershipType;
    }

    public void setOwnershipType(OwnershipType ownershipType) {
        this.ownershipType = ownershipType;
    }

    public String getSetCode() {
        return setCode;
    }

    public void setSetCode(String setCode) {
        this.setCode = setCode;
    }

    public Integer getManaValue() {
        return manaValue;
    }

    public void setManaValue(Integer manaValue) {
        this.manaValue = manaValue;
    }

    public String getTypes() {
        return types;
    }

    public void setTypes(String types) {
        this.types = types;
    }

    public String getColors() {
        return colors;
    }

    public void setColors(String colors) {
        this.colors = colors;
    }

    public String getImageUrl() {
        return imageUrl;
    }

    public void setImageUrl(String imageUrl) {
        this.imageUrl = imageUrl;
    }

    public boolean isDiscoverable() {
        return discoverable;
    }

    public void setDiscoverable(boolean discoverable) {
        this.discoverable = discoverable;
    }

    public boolean isCommanderEligible() {
        return commanderEligible;
    }

    public void setCommanderEligible(boolean commanderEligible) {
        this.commanderEligible = commanderEligible;
    }

    public String getSpawnRegion() {
        return spawnRegion;
    }

    public void setSpawnRegion(String spawnRegion) {
        this.spawnRegion = spawnRegion;
    }

    public Double getWeight() {
        return weight;
    }

    public void setWeight(Double weight) {
        this.weight = weight;
    }
}
