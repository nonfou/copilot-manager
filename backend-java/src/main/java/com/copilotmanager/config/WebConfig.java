package com.copilotmanager.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.File;

@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        String publicDir = resolvePublicDir();
        if (publicDir != null) {
            registry.addResourceHandler("/ui/**")
                    .addResourceLocations("file:" + publicDir + "/")
                    .setCachePeriod(3600);
        }
    }

    @Override
    public void addViewControllers(ViewControllerRegistry registry) {
        registry.addRedirectViewController("/", "/ui/");
        registry.addRedirectViewController("/ui", "/ui/");
    }

    public static String resolvePublicDir() {
        String[] candidates = {
                "frontend/dist",
                "../frontend/dist",
                "dist"
        };
        for (String c : candidates) {
            File f = new File(c);
            if (f.exists() && f.isDirectory()) {
                return f.getAbsolutePath();
            }
        }
        return null;
    }
}
