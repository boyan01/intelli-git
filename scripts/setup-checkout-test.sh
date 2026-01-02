#!/bin/bash

# Target test directory
TARGET_DIR="./.test/test-git-checkout"
mkdir -p "$TARGET_DIR"
# Resolve absolute path
TARGET_DIR=$(cd "$TARGET_DIR" && pwd)

echo "Target Testing Directory: $TARGET_DIR"

# Initialization function
init_repo() {
    cd "$TARGET_DIR" || exit
    echo ">>> Initializing/Resetting repository..."
    
    # Clean everything but keep folder structure
    rm -rf .git
    rm -rf *
    
    git init -b main
    
    # Config user for commit
    git config user.email "test@example.com"
    git config user.name "Test User"
    
    # Main branch state
    echo "File A content" > fileA.txt
    echo "File B content" > fileB.txt
    git add .
    git commit -m "Initial commit on main"
    
    # Create Feature branch (simulating remote branch)
    # Scenario: Current on main, want to checkout feature
    
    git checkout -b feature
    echo "File B modified on feature" > fileB.txt
    echo "File C (new on feature)" > newFileC.txt
    git add .
    git commit -m "Update fileB and add newFileC on feature"
    
    # Switch back to Main
    git checkout main
    echo ">>> Repository initialization complete."
    echo "    Current branch: main"
    echo "    Target branch: feature"
    echo "---------------------------------------------------"
}

# Scenario generation
case "$1" in
    "clean")
        init_repo
        echo "✅ Scenario 1: Clean State"
        echo "   Can switch to 'feature' directly."
        ;;
        
    "safe")
        init_repo
        echo "Modifying fileA..."
        echo "File A modified locally" > fileA.txt
        echo "✅ Scenario 2: Safe Local Modification (Non-conflicting)"
        echo "   Modified fileA.txt (main: A, feature: A)."
        echo "   Expectation: Git allows switch, fileA modifications carried over to feature branch."
        ;;
        
    "conflict")
        init_repo
        echo "Modifying fileB..."
        echo "File B modified locally" > fileB.txt
        echo "✅ Scenario 3: Conflicting Local Modification"
        echo "   Modified fileB.txt (main: B, feature: Modified B)."
        echo "   Expectation: Git refuses switch."
        echo "   IntelliJ Behavior: Prompts for Smart Checkout."
        ;;
        
    "untracked")
        init_repo
        echo "Creating newFileC..."
        echo "File C local content" > newFileC.txt
        echo "✅ Scenario 4: Untracked File Conflict"
        echo "   Created newFileC.txt (untracked)."
        echo "   Feature branch also has newFileC.txt."
        echo "   Expectation: Git refuses switch."
        echo "   IntelliJ Behavior: Prompts for Smart Checkout."
        ;;

    "staged")
        init_repo
        echo "Modifying and staging fileB..."
        echo "File B modified locally and staged" > fileB.txt
        git add fileB.txt
        echo "✅ Scenario 5: Staged Conflict"
        echo "   Modified and Staged fileB.txt."
        echo "   Expectation: Git refuses switch (same as unstaged conflict)."
        ;;

    "mixed")
        init_repo
        echo "Creating mixed state..."
        echo "File B modified locally" > fileB.txt
        echo "File C local content" > newFileC.txt
        echo "✅ Scenario 6: Mixed State Conflict"
        echo "   modified fileB.txt (Conflict) + newFileC.txt (Untracked Conflict)."
        echo "   Expectation: Git refuses switch."
        echo "   IntelliJ Behavior: Prompts for Smart Checkout. Should handle both."
        ;;
        
    *)
        echo "Usage: ./scripts/setup-checkout-test.sh [clean|safe|conflict|untracked|staged|mixed]"
        echo "  clean     - Clean state"
        echo "  safe      - Modify non-conflicting file (Git allows switch)"
        echo "  conflict  - Modify conflicting file (Git refuses switch)"
        echo "  untracked - Create conflicting untracked file (Git refuses switch)"
        echo "  staged    - Staged conflicting file (Git refuses switch)"
        echo "  mixed     - Mixed tracked and untracked conflicts"
        exit 1
        ;;
esac

echo "---------------------------------------------------"
git status
echo "---------------------------------------------------"
echo "Test Command: git checkout feature"
