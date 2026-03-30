package com.copilotmanager.crypto;

import com.copilotmanager.config.AppProperties;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.security.SecureRandom;

@Service
public class EncryptionService {

    private static final Logger log = LoggerFactory.getLogger(EncryptionService.class);
    private static final String ENC_PREFIX = "enc:";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_BITS = 128;
    private static final int GCM_TAG_BYTES = 16;

    private static EncryptionService instance;

    private final AppProperties appProperties;
    private byte[] keyBytes;

    public EncryptionService(AppProperties appProperties) {
        this.appProperties = appProperties;
    }

    @PostConstruct
    public void init() {
        String keyHex = appProperties.getEncryptionKey();
        if (keyHex == null || keyHex.isBlank()) {
            log.error("ENCRYPTION_KEY is not set. Refusing to start to prevent plaintext storage.");
            System.exit(1);
        }
        if (!keyHex.matches("[0-9a-fA-F]{64}")) {
            log.error("ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)");
            System.exit(1);
        }
        keyBytes = hexToBytes(keyHex);
        instance = this;
        log.info("AES-256-GCM encryption initialized");
    }

    public String encrypt(String plaintext) {
        if (plaintext == null || plaintext.startsWith(ENC_PREFIX)) {
            return plaintext;
        }
        try {
            byte[] iv = new byte[GCM_IV_LENGTH];
            new SecureRandom().nextBytes(iv);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(keyBytes, "AES"),
                    new GCMParameterSpec(GCM_TAG_BITS, iv));

            // doFinal returns ct + tag (tag is last GCM_TAG_BYTES bytes)
            byte[] encrypted = cipher.doFinal(plaintext.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            byte[] ct = java.util.Arrays.copyOf(encrypted, encrypted.length - GCM_TAG_BYTES);
            byte[] tag = java.util.Arrays.copyOfRange(encrypted, encrypted.length - GCM_TAG_BYTES, encrypted.length);

            return ENC_PREFIX + bytesToHex(iv) + ":" + bytesToHex(tag) + ":" + bytesToHex(ct);
        } catch (Exception e) {
            log.error("Encryption failed: {}", e.getMessage());
            return plaintext;
        }
    }

    public String decrypt(String value) {
        if (value == null || !value.startsWith(ENC_PREFIX)) {
            return value; // plaintext, backward compatible
        }
        try {
            String[] parts = value.substring(ENC_PREFIX.length()).split(":", 3);
            if (parts.length != 3) {
                log.warn("Invalid encrypted value format");
                return value;
            }
            byte[] iv = hexToBytes(parts[0]);
            byte[] tag = hexToBytes(parts[1]);
            byte[] ct = hexToBytes(parts[2]);

            // Java GCM expects ct + tag combined
            byte[] combined = new byte[ct.length + tag.length];
            System.arraycopy(ct, 0, combined, 0, ct.length);
            System.arraycopy(tag, 0, combined, ct.length, tag.length);

            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, new SecretKeySpec(keyBytes, "AES"),
                    new GCMParameterSpec(GCM_TAG_BITS, iv));

            byte[] plaintext = cipher.doFinal(combined);
            return new String(plaintext, java.nio.charset.StandardCharsets.UTF_8);
        } catch (Exception e) {
            log.error("Decryption failed (wrong key or corrupted data): {}", e.getMessage());
            return value;
        }
    }

    public static String encryptStatic(String v) {
        return instance != null ? instance.encrypt(v) : v;
    }

    public static String decryptStatic(String v) {
        return instance != null ? instance.decrypt(v) : v;
    }

    public static String bytesToHex(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    public static byte[] hexToBytes(String hex) {
        int len = hex.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(hex.charAt(i), 16) << 4)
                    + Character.digit(hex.charAt(i + 1), 16));
        }
        return data;
    }
}
