package com.copilotmanager.controller;

import com.copilotmanager.config.WebConfig;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ResponseBody;

import java.io.File;
import java.nio.file.Paths;

@Controller
public class SpaController {

    @GetMapping("/ui/**")
    @ResponseBody
    public ResponseEntity<Resource> spa(HttpServletRequest request) {
        String publicDir = WebConfig.resolvePublicDir();
        if (publicDir == null) {
            return ResponseEntity.notFound().build();
        }

        String uri = request.getRequestURI();
        // Strip /ui/ prefix
        String path = uri.startsWith("/ui/") ? uri.substring(4) : uri.substring(3);

        // Try the exact file
        File file = Paths.get(publicDir, path).normalize().toFile();
        if (file.exists() && file.isFile() && file.getAbsolutePath().startsWith(publicDir)) {
            return ResponseEntity.ok()
                    .contentType(guessMediaType(file.getName()))
                    .body(new FileSystemResource(file));
        }

        // Fallback to index.html (SPA routing)
        File index = new File(publicDir, "index.html");
        if (index.exists()) {
            return ResponseEntity.ok()
                    .contentType(MediaType.TEXT_HTML)
                    .body(new FileSystemResource(index));
        }

        return ResponseEntity.notFound().build();
    }

    private MediaType guessMediaType(String filename) {
        if (filename.endsWith(".js")) return MediaType.parseMediaType("application/javascript");
        if (filename.endsWith(".css")) return MediaType.parseMediaType("text/css");
        if (filename.endsWith(".html")) return MediaType.TEXT_HTML;
        if (filename.endsWith(".json")) return MediaType.APPLICATION_JSON;
        if (filename.endsWith(".png")) return MediaType.IMAGE_PNG;
        if (filename.endsWith(".jpg") || filename.endsWith(".jpeg")) return MediaType.IMAGE_JPEG;
        if (filename.endsWith(".svg")) return MediaType.parseMediaType("image/svg+xml");
        if (filename.endsWith(".ico")) return MediaType.parseMediaType("image/x-icon");
        if (filename.endsWith(".woff2")) return MediaType.parseMediaType("font/woff2");
        if (filename.endsWith(".woff")) return MediaType.parseMediaType("font/woff");
        return MediaType.APPLICATION_OCTET_STREAM;
    }
}
