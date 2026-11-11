package com.causalotel.order.controller;

import io.opentelemetry.api.trace.Span;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

import java.net.URI;
import java.time.Instant;
import java.util.HashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ResponseStatusException.class)
    public ProblemDetail handleResponseStatusException(ResponseStatusException ex) {
        log.warn("Application business exception: status={}, reason={}", ex.getStatusCode(), ex.getReason());
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(ex.getStatusCode(), ex.getReason());
        problem.setType(URI.create("https://causalotel.io/errors/" + ex.getStatusCode().value()));
        problem.setProperty("timestamp", Instant.now().toEpochMilli());
        attachTraceIdIfValid(problem);
        return problem;
    }

    @ExceptionHandler(com.causalotel.order.service.SagaOrchestrator.SagaLeaseLostException.class)
    public ProblemDetail handleLeaseLost(com.causalotel.order.service.SagaOrchestrator.SagaLeaseLostException ex) {
        log.warn("Saga ownership conflict: {}", ex.getMessage());
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.CONFLICT, ex.getMessage());
        problem.setType(URI.create("https://causalotel.io/errors/409"));
        problem.setProperty("code", "SAGA_LEASE_LOST");
        problem.setProperty("timestamp", Instant.now().toEpochMilli());
        attachTraceIdIfValid(problem);
        return problem;
    }

    @ExceptionHandler(com.causalotel.order.service.SagaOrchestrator.SagaPersistenceException.class)
    public ProblemDetail handleSagaPersistence(
            com.causalotel.order.service.SagaOrchestrator.SagaPersistenceException ex) {
        log.error("Saga persistence failure: {}", ex.getMessage(), ex);
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.SERVICE_UNAVAILABLE,
                "The order state could not be durably persisted. No success was reported.");
        problem.setType(URI.create("https://causalotel.io/errors/503"));
        problem.setProperty("code", "SAGA_PERSISTENCE_FAILURE");
        problem.setProperty("timestamp", Instant.now().toEpochMilli());
        attachTraceIdIfValid(problem);
        return problem;
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleValidationException(MethodArgumentNotValidException ex) {
        log.warn("Validation failure on request: {}", ex.getMessage());
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(HttpStatus.BAD_REQUEST, "Validation failed");
        problem.setType(URI.create("https://causalotel.io/errors/400"));
        problem.setProperty("timestamp", Instant.now().toEpochMilli());

        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getFieldErrors().forEach(error -> 
            errors.put(error.getField(), error.getDefaultMessage())
        );
        problem.setProperty("invalid_fields", errors);
        attachTraceIdIfValid(problem);
        return problem;
    }

    @ExceptionHandler(Exception.class)
    public ProblemDetail handleGenericException(Exception ex) {
        log.error("Unhandled internal server error: {}", ex.getMessage(), ex);
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(
                HttpStatus.INTERNAL_SERVER_ERROR, 
                "An unexpected internal error occurred. Please reference the incident trace."
        );
        problem.setType(URI.create("https://causalotel.io/errors/500"));
        problem.setProperty("timestamp", Instant.now().toEpochMilli());
        attachTraceIdIfValid(problem);
        return problem;
    }

    private void attachTraceIdIfValid(ProblemDetail problem) {
        try {
            Span currentSpan = Span.current();
            if (currentSpan != null && currentSpan.getSpanContext().isValid()) {
                String traceId = currentSpan.getSpanContext().getTraceId();
                if (traceId != null && !traceId.equals("00000000000000000000000000000000")) {
                    problem.setProperty("traceId", traceId);
                }
            }
        } catch (Throwable ignored) {}
    }
}
