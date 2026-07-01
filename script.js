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
let selectedChoice = null;

function updateSubmitState() {
    submitVote.disabled = !selectedChoice;
    submitVote.textContent = selectedChoice ? 'Submit Vote' : 'Select an option first';
}

function markSelectedCard() {
    choiceCards.forEach((card) => {
        card.classList.toggle('selected', card.dataset.choice === selectedChoice);
    });
}

async function getStoredVotes() {
    try {
        const response = await fetch(API_URL);
        if (!response.ok) return [];
        const payload = await response.json();
        return Array.isArray(payload.votes) ? payload.votes : [];
    } catch {
        const storedVotes = localStorage.getItem(VOTE_HISTORY_KEY);

        if (storedVotes) {
            try {
                const parsedVotes = JSON.parse(storedVotes);
                return Array.isArray(parsedVotes) ? parsedVotes : [];
            } catch {
                localStorage.removeItem(VOTE_HISTORY_KEY);
            }
        }

        const singleVote = localStorage.getItem(STORAGE_KEY);

        if (!singleVote) return [];

        try {
            const parsedVote = JSON.parse(singleVote);
            return parsedVote && parsedVote.choice ? [parsedVote] : [];
        } catch {
            localStorage.removeItem(STORAGE_KEY);
            return [];
        }
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

    const votes = await getStoredVotes();
    const counts = { support: 0, oppose: 0, neutral: 0 };

    if (votes.length && !localStorage.getItem(VOTE_HISTORY_KEY) && localStorage.getItem(STORAGE_KEY)) {
        localStorage.setItem(VOTE_HISTORY_KEY, JSON.stringify(votes));
    }

    votes.forEach((vote) => {
        if (vote && vote.choice && counts[vote.choice] !== undefined) {
            counts[vote.choice] += 1;
        }
    });

    const totalVotes = votes.length;

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

    summaryValues[0].textContent = totalVotes.toString();
    summaryValues[1].textContent = counts.support.toString();
    summaryValues[2].textContent = counts.oppose.toString();
    summaryValues[3].textContent = counts.neutral.toString();

    const formatPercent = (count) => (totalVotes ? `${Math.round((count / totalVotes) * 100)}%` : '0%');

    if (supportPercent) supportPercent.textContent = formatPercent(counts.support);
    if (opposePercent) opposePercent.textContent = formatPercent(counts.oppose);
    if (neutralPercent) neutralPercent.textContent = formatPercent(counts.neutral);

    if (supportBar) supportBar.style.width = formatPercent(counts.support);
    if (opposeBar) opposeBar.style.width = formatPercent(counts.oppose);
    if (neutralBar) neutralBar.style.width = formatPercent(counts.neutral);
}

async function saveVote(choice, reason) {
    if (!validChoices.includes(choice)) return;

    const vote = {
        choice,
        reason: reason.trim(),
        timestamp: new Date().toISOString()
    };

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(vote)
        });

        if (!response.ok) {
            throw new Error('Network error');
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(vote));
        submitVote.disabled = true;
        voteStatus.classList.remove('hidden');
        voteStatus.querySelector('strong').textContent = 'Vote recorded';
        statusCopy.textContent = 'Thank you for sharing your opinion. Results are available on the dashboard.';
        thankYouPanel.classList.add('visible');
        await updateResultsPage();
    } catch {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(vote));
        submitVote.disabled = true;
        voteStatus.classList.remove('hidden');
        voteStatus.querySelector('strong').textContent = 'Vote recorded';
        statusCopy.textContent = 'Thank you for sharing your opinion. Results are available on the dashboard.';
        thankYouPanel.classList.add('visible');
        await updateResultsPage();
    }
}

function loadStoredVote() {
    const storedVote = localStorage.getItem(STORAGE_KEY);

    if (!storedVote) return;

    try {
        const vote = JSON.parse(storedVote);

        if (!vote || !vote.choice || !validChoices.includes(vote.choice)) {
            localStorage.removeItem(STORAGE_KEY);
            return;
        }

        selectedChoice = vote.choice;
        markSelectedCard();

        submitVote.disabled = true;

        voteStatus.classList.remove('hidden');
        voteStatus.querySelector('strong').textContent = 'Vote already recorded';

        const savedDate = vote.timestamp
            ? dateFormatter.format(new Date(vote.timestamp))
            : 'recently';

        statusCopy.textContent = `Your ${vote.choice} vote was saved on ${savedDate}.`;
        thankYouPanel.classList.add('visible');
    } catch {
        localStorage.removeItem(STORAGE_KEY);
    }
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
