package com.causalotel.payment.security;

import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import java.io.IOException;

/**
 * H-01/H-02: fault control is admin-only; charge/refund require a service or
 * admin credential; all payment reads require a privileged role.
 */
@Configuration
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http, TokenService tokenService)
            throws Exception {
        http
                .csrf(csrf -> csrf.disable())
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers("/actuator/health/**", "/actuator/health", "/actuator/info",
                                "/actuator/prometheus", "/actuator/metrics/**", "/error").permitAll()
                        .requestMatchers("/api/payments/fault").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.POST, "/api/payments/charge").hasAnyRole("SERVICE", "ADMIN")
                        .requestMatchers(HttpMethod.POST, "/api/payments/refund").hasAnyRole("SERVICE", "ADMIN")
                        .requestMatchers("/api/payments/**").hasAnyRole("ADMIN", "SERVICE")
                        .anyRequest().authenticated())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint((request, response, authException) ->
                                writeProblem(response, 401, "UNAUTHORIZED", "Authentication required"))
                        .accessDeniedHandler((request, response, deniedException) ->
                                writeProblem(response, 403, "FORBIDDEN", "Insufficient role for this operation")))
                .addFilterBefore(new TokenAuthenticationFilter(tokenService),
                        UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }

    private static void writeProblem(HttpServletResponse response, int status, String code, String message)
            throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write("{\"status\":" + status + ",\"code\":\"" + code
                + "\",\"message\":\"" + message + "\"}");
    }
}
