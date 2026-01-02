#!/bin/bash

# Target test directory
# Test Directories
BASE_DIR="./.test"
BARE_REPO="${BASE_DIR}/repo.git"
TARGET_DIR="${BASE_DIR}/test-git-checkout"

mkdir -p "$BASE_DIR"
# Resolve absolute paths
BARE_REPO=$(cd "$BASE_DIR" && mkdir -p repo.git && cd repo.git && pwd)
TARGET_DIR_PARENT=$(cd "$BASE_DIR" && pwd)
TARGET_DIR="${TARGET_DIR_PARENT}/test-git-checkout"

echo "Remote Repo (Bare): $BARE_REPO"
echo "Client Repo (Work): $TARGET_DIR"

# Initialization function
init_repo() {
    echo ">>> Initializing/Resetting repositories..."
    
    # 1. Clean up
    rm -rf "$BARE_REPO"
    rm -rf "$TARGET_DIR"
    
    # 2. Setup Bare Repo (Remote)
    git init --bare "$BARE_REPO"
    
    # 3. Setup Temp Repo to push initial content
    TEMP_DIR="${BASE_DIR}/temp_setup"
    rm -rf "$TEMP_DIR"
    mkdir -p "$TEMP_DIR"
    cd "$TEMP_DIR"
    git init
    git config user.email "setup@example.com"
    git config user.name "Setup User"
    
    # Create Main content
    echo "File A content" > fileA.txt
    echo "File B content" > fileB.txt
    git add .
    git commit -m "Initial commit on main"
    
    # Create Feature branch
    git checkout -b feature
    echo "File B modified on feature" > fileB.txt
    echo "File C (new on feature)" > newFileC.txt
    git add .
    git commit -m "Update fileB and add newFileC on feature"
    
    # Push everything to Bare Repo
    git remote add origin "$BARE_REPO"
    git push origin main feature
    
    # Cleanup temp
    cd ..
    rm -rf "$TEMP_DIR"
    
    # 4. Clone to Target Directory (Client)
    echo ">>> Cloning to client..."
    git clone "$BARE_REPO" "$TARGET_DIR"
    cd "$TARGET_DIR"
    git config user.email "test@example.com"
    git config user.name "Test User"
    
    # Client starts at main
    # Ensure feature is NOT checked out locally yet to simulate remote checkout
    # Cloning usually checks out main (HEAD)
    
    echo ">>> Repository initialization complete."
    echo "    Current branch: main"
    echo "    Remote branches: origin/main, origin/feature"
    echo "---------------------------------------------------"
}

# Scenario generation
case "$1" in
    "clean")
        init_repo
        echo "✅ Scenario 1: Clean State"
        echo "   Can switch to 'origin/feature' directly (will create local 'feature')."
        ;;
        
    "safe")
        init_repo
        echo "Modifying fileA..."
        echo "File A modified locally" > fileA.txt
        echo "✅ Scenario 2: Safe Local Modification (Non-conflicting)"
        echo "   Modified fileA.txt (main: A, feature: A)."
        echo "   Expectation: Git allows switch, fileA modifications carried over to new local feature branch."
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
        
    "ahead")
        init_repo
        # Checkout feature first to create local branch
        git checkout feature
        # Make a commit to be ahead
        echo "Commit ahead" > ahead.txt
        git add ahead.txt
        git commit -m "Local feature is ahead"
        # Switch back to main to simulate starting point
        git checkout main
        
        echo "Modifying fileB (Conflict)..."
        echo "File B modified locally" > fileB.txt
        
        echo "✅ Scenario 7: Branch Ahead + Local Conflict"
        echo "   Local 'feature' exists and is ahead of 'origin/feature'."
        echo "   Also have local conflict in fileB.txt on 'main'."
        echo "   Expectation: Git refuses switch to 'feature' due to fileB."
        echo "   IntelliJ Behavior: Prompts Smart Checkout. After switch, should be on local 'feature' (ahead)."
        ;;
        
    "behind")
        init_repo
        # Checkout feature first
        git checkout feature
        # Reset hard to previous commit to be behind (assuming feature has >1 commits, actually our init creates 1 commit on feature)
        # Let's create a new commit on remote instead to make local behind
        
        # Use temp dir to push new commit to bare repo
        TEMP_DIR="${BASE_DIR}/temp_update"
        mkdir -p "$TEMP_DIR"
        git clone "$BARE_REPO" "$TEMP_DIR"
        cd "$TEMP_DIR"
        git checkout feature
        echo "Remote update" > remote_update.txt
        git add .
        git commit -m "Remote updated feature"
        git push
        cd ..
        rm -rf "$TEMP_DIR"
        
        # Back to target dir
        cd "$TARGET_DIR"
        # Fetch to know about update
        git fetch
        
        # Go back to main
        git checkout main
        
        echo "Modifying fileB (Conflict)..."
        echo "File B modified locally" > fileB.txt
        
        echo "✅ Scenario 8: Branch Behind + Local Conflict"
        echo "   Local 'feature' exists and is behind 'origin/feature'."
        echo "   Also have local conflict in fileB.txt on 'main'."
        echo "   Expectation: Git refuses switch to 'feature' due to fileB."
        echo "   IntelliJ Behavior: Prompts Smart Checkout. After switch, should be on local 'feature' (behind)."
        ;;
        
    *)
        echo "Usage: ./scripts/setup-checkout-test.sh [clean|safe|conflict|untracked|staged|mixed|ahead|behind]"
        exit 1
        ;;
esac

echo "---------------------------------------------------"
git status
echo "---------------------------------------------------"
echo "Test Command: Check out 'origin/feature' from VS Code side bar or palette."
