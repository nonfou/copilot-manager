package com.copilotmanager.ssrf;

import org.springframework.stereotype.Component;

import java.net.InetAddress;
import java.net.URI;
import java.net.UnknownHostException;

@Component
public class SsrfValidator {

    public void validate(String urlStr) {
        if (urlStr == null || urlStr.isBlank()) {
            throw new IllegalArgumentException("api_url is required");
        }
        URI uri;
        try {
            uri = URI.create(urlStr);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid URL format: " + urlStr);
        }
        String scheme = uri.getScheme();
        if (!"http".equals(scheme) && !"https".equals(scheme)) {
            throw new IllegalArgumentException("api_url must use http or https scheme");
        }
        String host = uri.getHost();
        if (host == null || host.isBlank()) {
            throw new IllegalArgumentException("api_url must have a valid host");
        }
        try {
            InetAddress addr = InetAddress.getByName(host);
            if (isPrivateOrLoopback(addr)) {
                throw new IllegalArgumentException("api_url must not point to a private or loopback address");
            }
        } catch (UnknownHostException e) {
            // Allow unresolvable hosts (e.g., container names in prod)
        }
    }

    private boolean isPrivateOrLoopback(InetAddress addr) {
        if (addr.isLoopbackAddress()) return true;
        if (addr.isSiteLocalAddress()) return true;
        if (addr.isLinkLocalAddress()) return true;
        byte[] bytes = addr.getAddress();
        if (bytes.length == 4) {
            int b0 = bytes[0] & 0xFF;
            int b1 = bytes[1] & 0xFF;
            // 10.x.x.x
            if (b0 == 10) return true;
            // 172.16-31.x.x
            if (b0 == 172 && b1 >= 16 && b1 <= 31) return true;
            // 192.168.x.x
            if (b0 == 192 && b1 == 168) return true;
            // 169.254.x.x
            if (b0 == 169 && b1 == 254) return true;
        }
        if (bytes.length == 16) {
            // fc00::/7 ULA
            if ((bytes[0] & 0xFE) == 0xFC) return true;
            // fe80::/10 link-local
            if (bytes[0] == (byte)0xFE && (bytes[1] & 0xC0) == 0x80) return true;
        }
        return false;
    }
}
