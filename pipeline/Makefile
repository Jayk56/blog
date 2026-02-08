.PHONY: help new transcribe increment-transcribe preprocess update-preprocess draft review collect publish status advance editor all clean

# Get the directory where this Makefile is located
MAKEFILE_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
SCRIPTS_DIR := $(MAKEFILE_DIR)scripts

# Color output
BLUE := \033[0;34m
GREEN := \033[0;32m
RED := \033[0;31m
NC := \033[0m

help:
	@echo "$(BLUE)Blog Pipeline Makefile$(NC)"
	@echo ""
	@echo "$(GREEN)Usage:$(NC)"
	@echo "  make new SLUG=slug-name CATEGORY=learned|found|built"
	@echo "  make transcribe SLUG=slug-name"
	@echo "  make advance SLUG=slug-name"
	@echo "  make status [SLUG=slug-name]"
	@echo "  make preprocess SLUG=slug-name"
	@echo "  make increment-transcribe SLUG=slug-name  (transcribe new audio only)"
	@echo "  make update-preprocess SLUG=slug-name     (update outline with new content)"
	@echo "  make draft SLUG=slug-name"
	@echo "  make review SLUG=slug-name"
	@echo "  make collect SLUG=slug-name"
	@echo "  make publish SLUG=slug-name"
	@echo "  make all SLUG=slug-name"
	@echo "  make clean"
	@echo ""
	@echo "$(GREEN)Examples:$(NC)"
	@echo "  make new SLUG=my-post CATEGORY=learned"
	@echo "  make transcribe SLUG=my-post"
	@echo "  make status"
	@echo "  make all SLUG=my-post"

# Check that required arguments are provided
check-slug:
	@if [ -z "$(SLUG)" ]; then \
		echo "$(RED)Error: SLUG is required$(NC)"; \
		exit 1; \
	fi

check-category:
	@if [ -z "$(CATEGORY)" ]; then \
		echo "$(RED)Error: CATEGORY is required$(NC)"; \
		exit 1; \
	fi

# Initialize a new post
new: check-slug check-category
	@$(SCRIPTS_DIR)/new-post.sh "$(SLUG)" "$(CATEGORY)"

# Transcribe audio files
transcribe: check-slug
	@$(SCRIPTS_DIR)/transcribe.sh "$(SLUG)"

# Advance to next stage
advance: check-slug
	@$(SCRIPTS_DIR)/advance.sh "$(SLUG)"

# Placeholder targets for other stages
# These serve as documentation and can be expanded with specific processing logic

# Transcribe only new audio files (without resetting stage)
increment-transcribe: check-slug
	@$(SCRIPTS_DIR)/increment-transcribe.sh "$(SLUG)"

preprocess: check-slug
	@$(SCRIPTS_DIR)/preprocess.sh "$(SLUG)"

# Update existing outline with new transcript content
update-preprocess: check-slug
	@$(SCRIPTS_DIR)/preprocess.sh "$(SLUG)" --update

draft: check-slug advance
	@echo "$(BLUE)Draft stage for $(SLUG)$(NC)"
	@echo "Write the draft blog post based on processed content"

review: check-slug advance
	@echo "$(BLUE)Review stage for $(SLUG)$(NC)"
	@echo "Review and edit the draft post"

collect: check-slug
	@$(SCRIPTS_DIR)/collect.sh "$(SLUG)"

publish: check-slug
	@$(SCRIPTS_DIR)/publish.sh "$(SLUG)"

# Show status
status:
	@if [ -z "$(SLUG)" ]; then \
		$(SCRIPTS_DIR)/status.sh; \
	else \
		$(SCRIPTS_DIR)/status.sh "$(SLUG)"; \
	fi

# Launch the blog editor web app
editor:
	@echo "$(BLUE)Starting blog editor...$(NC)"
	@cd $(MAKEFILE_DIR)../editor && npm run dev

# Run full pipeline for a post
all: check-slug new transcribe advance
	@echo ""
	@echo "$(GREEN)✓ Pipeline initialized for $(SLUG)$(NC)"
	@echo "Next: Record audio, then run 'make transcribe SLUG=$(SLUG)'"

# Clean up - remove pipeline cache or temporary files
clean:
	@echo "$(RED)Clean not yet implemented$(NC)"
	@echo "Implement carefully to avoid data loss"

.DEFAULT_GOAL := help
