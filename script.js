const STORAGE_KEY = 'myfuelmychoice_vote';
const VOTE_HISTORY_KEY = 'myfuelmychoice_votes';
const API_URL = '/api/votes';
const validChoices = ['support', 'oppose', 'neutral'];
const dateFormatter = new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
});
const choiceCards = document.querySelectorAll('.choice-card');
const submitVote = document.getElementById('submitVote');
const reasonInput = document.getElementById('reason');
const thankYouPanel = document.querySelector('.thank-you-panel');
const voteStatus = document.querySelector('.vote-status');
const statusCopy = document.querySelector('.status-copy');
const successStateCard = document.querySelector('.state-card--success');
const errorStateCard = document.querySelector('.state-card--vote-failed');
const duplicateStateCard = document.querySelector('.state-card--already-voted');
let selectedChoice = null;

function setActiveStateCard(activeCard) {
    [successStateCard, errorStateCard, duplicateStateCard].forEach((card) => {
        if (!card) return;
        card.classList.toggle('hidden', card !== activeCard);
    });

    if (voteStatus) {
        voteStatus.classList.add('hidden');
    }

    if (thankYouPanel) {
        thankYouPanel.classList.remove('visible');
        thankYouPanel.classList.add('hidden');
    }
}

function showSuccessState() {
    setActiveStateCard(successStateCard);
}

function showErrorState() {
    setActiveStateCard(errorStateCard);
}

function showDuplicateState() {
    setActiveStateCard(duplicateStateCard);
}

function readStoredVote() {
    const storedVote = localStorage.getItem(STORAGE_KEY);

    if (!storedVote) return null;

    try {
        const vote = JSON.parse(storedVote);

        if (!vote || !vote.choice || !validChoices.includes(vote.choice)) {
            localStorage.removeItem(STORAGE_KEY);
            return null;
        }

        return vote;
    } catch {
        localStorage.removeItem(STORAGE_KEY);
        return null;
    }
}

function updateSubmitState() {
    submitVote.disabled = !selectedChoice;
    submitVote.textContent = selectedChoice ? 'Submit Vote' : 'Select an option first';
}

function markSelectedCard() {
    choiceCards.forEach((card) => {
        card.classList.toggle('selected', card.dataset.choice === selectedChoice);
    });
}

async function getStoredResults() {
    const fallback = {
        votes: [],
        counts: { support: 0, oppose: 0, neutral: 0 },
        totalVotes: 0
    };

    try {
        const response = await fetch(API_URL);
        if (!response.ok) return fallback;

        const payload = await response.json();
        if (payload && Array.isArray(payload.votes)) {
            return {
                votes: payload.votes,
                counts: {
                    support: typeof payload.counts?.support === 'number' ? payload.counts.support : 0,
                    oppose: typeof payload.counts?.oppose === 'number' ? payload.counts.oppose : 0,
                    neutral: typeof payload.counts?.neutral === 'number' ? payload.counts.neutral : 0
                },
                totalVotes: typeof payload.totalVotes === 'number' ? payload.totalVotes : payload.votes.length
            };
        }

        return fallback;
    } catch {
        const storedVotes = localStorage.getItem(VOTE_HISTORY_KEY);
        if (storedVotes) {
            try {
                const parsedVotes = JSON.parse(storedVotes);
                if (Array.isArray(parsedVotes)) {
                    const counts = { support: 0, oppose: 0, neutral: 0 };
                    parsedVotes.forEach((vote) => {
                        if (vote && vote.choice && counts[vote.choice] !== undefined) {
                            counts[vote.choice] += 1;
                        }
                    });
                    return { votes: parsedVotes, counts, totalVotes: parsedVotes.length };
                }
            } catch {
                localStorage.removeItem(VOTE_HISTORY_KEY);
            }
        }

        const singleVote = localStorage.getItem(STORAGE_KEY);
        if (!singleVote) return fallback;

        try {
            const parsedVote = JSON.parse(singleVote);
            if (parsedVote && parsedVote.choice) {
                const counts = { support: 0, oppose: 0, neutral: 0 };
                if (counts[parsedVote.choice] !== undefined) {
                    counts[parsedVote.choice] = 1;
                }
                return { votes: [parsedVote], counts, totalVotes: 1 };
            }
        } catch {
            localStorage.removeItem(STORAGE_KEY);
        }

        return fallback;
    }
}

async function updateResultsPage() {
    const summaryValues = document.querySelectorAll('.results-grid article strong');
    const supportPercent = document.getElementById('supportPercent');
    const opposePercent = document.getElementById('opposePercent');
    const neutralPercent = document.getElementById('neutralPercent');
    const supportBar = document.querySelector('.bar-support span');
    const opposeBar = document.querySelector('.bar-oppose span');
    const neutralBar = document.querySelector('.bar-neutral span');
    const resultsGrid = document.querySelector('.results-grid');
    const loadingState = document.querySelector('.state-card--loading');
    const emptyState = document.querySelector('.state-card--empty');
    const offlineState = document.querySelector('.state-card--offline');
    const errorState = document.querySelector('.state-card--error');

    if (!summaryValues.length) return;

    const { votes, counts: apiCounts, totalVotes: apiTotalVotes } = await getStoredResults();
    const counts = { support: 0, oppose: 0, neutral: 0 };

    votes.forEach((vote) => {
        if (vote && vote.choice && counts[vote.choice] !== undefined) {
            counts[vote.choice] += 1;
        }
    });

    const countsToDisplay = {
        support: apiCounts.support ?? counts.support,
        oppose: apiCounts.oppose ?? counts.oppose,
        neutral: apiCounts.neutral ?? counts.neutral
    };
    const totalVotes = apiTotalVotes ?? votes.length;

    if (resultsGrid) {
        resultsGrid.setAttribute('aria-busy', 'false');
    }
    if (loadingState) {
        loadingState.style.display = 'none';
    }
    if (emptyState) {
        emptyState.style.display = totalVotes ? 'none' : 'flex';
    }
    if (offlineState) {
        offlineState.style.display = 'none';
    }
    if (errorState) {
        errorState.style.display = 'none';
    }

    if (votes.length && !localStorage.getItem(VOTE_HISTORY_KEY) && localStorage.getItem(STORAGE_KEY)) {
        localStorage.setItem(VOTE_HISTORY_KEY, JSON.stringify(votes));
    }

    summaryValues[0].textContent = totalVotes.toString();
    summaryValues[1].textContent = countsToDisplay.support.toString();
    summaryValues[2].textContent = countsToDisplay.oppose.toString();
    summaryValues[3].textContent = countsToDisplay.neutral.toString();

    const formatPercent = (count) => (totalVotes ? `${Math.round((count / totalVotes) * 100)}%` : '0%');

    if (supportPercent) supportPercent.textContent = formatPercent(countsToDisplay.support);
    if (opposePercent) opposePercent.textContent = formatPercent(countsToDisplay.oppose);
    if (neutralPercent) neutralPercent.textContent = formatPercent(countsToDisplay.neutral);

    if (supportBar) supportBar.style.width = formatPercent(countsToDisplay.support);
    if (opposeBar) opposeBar.style.width = formatPercent(countsToDisplay.oppose);
    if (neutralBar) neutralBar.style.width = formatPercent(countsToDisplay.neutral);
}

async function getCsrfToken() {
    try {
        const response = await fetch('/api/csrf-token', {
            method: 'GET',
            credentials: 'same-origin'
        });
        if (!response.ok) {
            return null;
        }
        const payload = await response.json();
        return payload && typeof payload.token === 'string' ? payload.token : null;
    } catch {
        return null;
    }
}

async function saveVote(choice, reason) {
    if (!validChoices.includes(choice)) return;

    const existingVote = readStoredVote();
    if (existingVote) {
        selectedChoice = existingVote.choice;
        markSelectedCard();
        updateSubmitState();
        showDuplicateState();
        return;
    }

    const vote = {
        choice,
        reason: reason.trim(),
        timestamp: new Date().toISOString()
    };

    const csrfToken = await getCsrfToken();
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
    }

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers,
            credentials: 'same-origin',
            body: JSON.stringify(vote)
        });

        if (!response.ok) {
            if (response.status === 409) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(vote));
                showDuplicateState();
                return;
            }
            throw new Error('Network error');
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(vote));
        submitVote.disabled = true;
        showSuccessState();
        await updateResultsPage();
    } catch {
        submitVote.disabled = false;
        updateSubmitState();
        showErrorState();
        await updateResultsPage();
    }
}

function loadStoredVote() {
    const vote = readStoredVote();

    if (!vote) return;

    selectedChoice = vote.choice;
    markSelectedCard();

    submitVote.disabled = true;
    showDuplicateState();
}

choiceCards.forEach((card) => {
    card.addEventListener('click', () => {
        selectedChoice = card.dataset.choice;
        markSelectedCard();
        updateSubmitState();
    });
});

submitVote?.addEventListener('click', () => {
    if (!selectedChoice) return;
    saveVote(selectedChoice, reasonInput.value);
});

if (choiceCards.length && submitVote) {
    updateSubmitState();
    loadStoredVote();
}

if (typeof window !== 'undefined') {
    window.addEventListener('load', () => {
        updateResultsPage();
    });
}

updateResultsPage();
