"use client";

import { useCallback, useEffect, useState } from "react";
import ControlButton from "./_components/button/control-button";
import Grid from "./_components/game/grid";
import GameLostModal from "./_components/modal/game-lost-modal";
import GameWonModal from "./_components/modal/game-won-modal";
import Popup from "./_components/popup";
import useAnimation from "./_hooks/use-animation";
import useGameLogic from "./_hooks/use-game-logic";
import usePopup from "./_hooks/use-popup";
import { Category, SubmitResult, Word } from "./_types";
import { getPerfection } from "./_utils";

type PuzzleApiResponse = {
  date: string;
  todayNz: string;
  availableDates: string[];
  categories: Category[];
};

export default function Home() {
  const [popupState, showPopup] = usePopup();

  // Puzzle state
  const [puzzleCategories, setPuzzleCategories] = useState<Category[] | null>(
    null
  );
  const [availableDates, setAvailableDates] = useState<string[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [todayNz, setTodayNz] = useState<string>("");

  const [loadingPuzzle, setLoadingPuzzle] = useState(true);
  const [puzzleError, setPuzzleError] = useState<string | null>(null);

  const loadPuzzle = async (date?: string) => {
    setLoadingPuzzle(true);
    setPuzzleError(null);

    try {
      const qs = date ? `?date=${encodeURIComponent(date)}` : "";
      const res = await fetch(`/api/puzzle${qs}`, { cache: "no-store" });

      const data = (await res.json()) as Partial<PuzzleApiResponse> & {
        error?: string;
      };

      if (!res.ok) {
        setPuzzleError(data.error || "Failed to load puzzle.");
        setLoadingPuzzle(false);
        return;
      }

      const full = data as PuzzleApiResponse;

      setPuzzleCategories(full.categories);
      setAvailableDates(full.availableDates);
      setSelectedDate(full.date);
      setTodayNz(full.todayNz);
    } catch (e) {
      setPuzzleError(e instanceof Error ? e.message : "Failed to load puzzle.");
    } finally {
      setLoadingPuzzle(false);
    }
  };

  useEffect(() => {
    loadPuzzle(); // loads todayNZ puzzle (or latest available)
  }, []);

  const {
    gameWords,
    selectedWords,
    clearedCategories,
    mistakesRemaining,
    isWon,
    isLost,
    guessHistoryRef,
    selectWord,
    shuffleWords,
    deselectAllWords,
    getSubmitResult,
    handleWin,
    handleLoss,
  } = useGameLogic(puzzleCategories);

  const [showGameWonModal, setShowGameWonModal] = useState(false);
  const [showGameLostModal, setShowGameLostModal] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const { guessAnimationState, wrongGuessAnimationState, animateGuess, animateWrongGuess } =
    useAnimation();

  const controlsDisabled =
    loadingPuzzle || !!puzzleError || !puzzleCategories || puzzleCategories.length !== 4;

  const handleSubmit = async () => {
    if (controlsDisabled) return;

    setSubmitted(true);
    await animateGuess(selectedWords);

    const result: SubmitResult = getSubmitResult();

    switch (result.result) {
      case "same":
        showPopup("You've already guessed that!");
        break;
      case "one-away":
        animateWrongGuess();
        showPopup("One away...");
        break;
      case "loss":
        showPopup("Better luck next time!");
        await handleLoss();
        setShowGameLostModal(true);
        break;
      case "win":
        showPopup(getPerfection(mistakesRemaining));
        await handleWin();
        setShowGameWonModal(true);
        break;
      case "incorrect":
        animateWrongGuess();
        break;
    }

    setSubmitted(false);
  };

  const onClickCell = useCallback(
    (word: Word) => {
      if (controlsDisabled) return;
      selectWord(word);
    },
    [selectWord, controlsDisabled]
  );

  const renderControlButtons = () => {
    const showResultsWonButton = (
      <ControlButton text="Show Results" onClick={() => setShowGameWonModal(true)} />
    );

    const showResultsLostButton = (
      <ControlButton text="Show Results" onClick={() => setShowGameLostModal(true)} />
    );

    const inProgressButtons = (
      <div className="flex gap-2 mb-12">
        <ControlButton
          text="Shuffle"
          onClick={shuffleWords}
          unclickable={submitted || controlsDisabled}
        />
        <ControlButton
          text="Deselect All"
          onClick={deselectAllWords}
          unclickable={selectedWords.length === 0 || submitted || controlsDisabled}
        />
        <ControlButton
          text="Submit"
          unclickable={selectedWords.length !== 4 || submitted || controlsDisabled}
          onClick={handleSubmit}
        />
      </div>
    );

    if (isWon) return showResultsWonButton;
    if (isLost) return showResultsLostButton;
    return inProgressButtons;
  };

  return (
    <>
      <div className="flex flex-col items-center w-11/12 md:w-3/4 lg:w-7/12 mx-auto mt-14">
        <div className="w-full flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h1 className="text-black text-4xl font-semibold my-2 ml-4">🥝-connect</h1>
            <div className="text-black ml-4 text-sm opacity-80">
              Puzzle date: <span className="font-medium">{selectedDate || "…"}</span>
              {todayNz ? (
                <span className="ml-2">(NZ today: {todayNz})</span>
              ) : null}
            </div>
          </div>

          <div className="ml-4 md:ml-0">
            <label className="text-black text-sm mr-2">Choose a day:</label>
            <select
              className="border border-black rounded px-2 py-1 text-black"
              value={selectedDate}
              disabled={loadingPuzzle || availableDates.length === 0}
              onChange={(e) => {
                const d = e.target.value;
                setShowGameWonModal(false);
                setShowGameLostModal(false);
                loadPuzzle(d);
              }}
            >
              {availableDates.map((d) => (
                <option key={d} value={d}>
                  {d === todayNz ? `Today (${d})` : d}
                </option>
              ))}
            </select>
          </div>
        </div>

        <hr className="mb-4 mt-4 w-full" />
        <h1 className="text-black mb-4">Create four groups of four!</h1>

        {puzzleError ? (
          <div className="w-full border border-black rounded p-3 text-black bg-white">
            <div className="font-semibold">Could not load puzzle</div>
            <div className="text-sm mt-1">{puzzleError}</div>
          </div>
        ) : null}

        {loadingPuzzle ? (
          <div className="text-black my-6">Loading puzzle…</div>
        ) : null}

        <div className="relative w-full">
          <Popup show={popupState.show} message={popupState.message} />
          <Grid
            words={gameWords}
            selectedWords={selectedWords}
            onClick={onClickCell}
            clearedCategories={clearedCategories}
            guessAnimationState={guessAnimationState}
            wrongGuessAnimationState={wrongGuessAnimationState}
          />
        </div>

        <h2 className="text-black my-4 md:my-8 mx-8">
          Mistakes Remaining:{" "}
          {mistakesRemaining > 0 ? Array(mistakesRemaining).fill("•") : ""}
        </h2>

        {renderControlButtons()}
      </div>

      <GameWonModal
        isOpen={showGameWonModal}
        onClose={() => setShowGameWonModal(false)}
        guessHistory={guessHistoryRef.current}
        perfection={getPerfection(mistakesRemaining)}
      />
      <GameLostModal
        isOpen={showGameLostModal}
        onClose={() => setShowGameLostModal(false)}
        guessHistory={guessHistoryRef.current}
      />
    </>
  );
}
