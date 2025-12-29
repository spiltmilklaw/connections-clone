import { useEffect, useMemo, useRef, useState } from "react";
import { Category, SubmitResult, Word } from "../_types";
import { delay, shuffleArray } from "../_utils";

export default function useGameLogic(puzzleCategories: Category[] | null) {
  const [gameWords, setGameWords] = useState<Word[]>([]);
  const selectedWords = useMemo(
    () => gameWords.filter((item) => item.selected),
    [gameWords]
  );

  const [clearedCategories, setClearedCategories] = useState<Category[]>([]);
  const [isWon, setIsWon] = useState(false);
  const [isLost, setIsLost] = useState(false);
  const [mistakesRemaining, setMistakesRemaning] = useState(4);
  const guessHistoryRef = useRef<Word[][]>([]);

  // When puzzle changes, reset the whole game state
  useEffect(() => {
    if (!puzzleCategories || puzzleCategories.length === 0) return;

    guessHistoryRef.current = [];
    setClearedCategories([]);
    setIsWon(false);
    setIsLost(false);
    setMistakesRemaning(4);

    const words: Word[] = puzzleCategories
      .map((category) =>
        category.items.map((word) => ({ word: word, level: category.level }))
      )
      .flat();

    setGameWords(shuffleArray(words));
  }, [puzzleCategories]);

  const selectWord = (word: Word): void => {
    const newGameWords = gameWords.map((item) => {
      if (word.word === item.word) {
        return {
          ...item,
          selected: selectedWords.length < 4 ? !item.selected : false,
        };
      }
      return item;
    });

    setGameWords(newGameWords);
  };

  const shuffleWords = () => {
    setGameWords([...shuffleArray(gameWords)]);
  };

  const deselectAllWords = () => {
    setGameWords(gameWords.map((item) => ({ ...item, selected: false })));
  };

  const getSubmitResult = (): SubmitResult => {
    if (!puzzleCategories) return { result: "incorrect" };

    const sameGuess = guessHistoryRef.current.some((guess) =>
      guess.every((word) => selectedWords.includes(word))
    );

    if (sameGuess) return { result: "same" };

    guessHistoryRef.current.push(selectedWords);

    const likenessCounts = puzzleCategories.map((category) => {
      return selectedWords.filter((item) => category.items.includes(item.word))
        .length;
    });

    const maxLikeness = Math.max(...likenessCounts);
    const maxIndex = likenessCounts.indexOf(maxLikeness);

    if (maxLikeness === 4) {
      return getCorrectResult(puzzleCategories[maxIndex]);
    } else {
      return getIncorrectResult(maxLikeness);
    }
  };

  const getCorrectResult = (category: Category): SubmitResult => {
    setClearedCategories([...clearedCategories, category]);
    setGameWords(gameWords.filter((item) => !category.items.includes(item.word)));

    if (clearedCategories.length === 3) {
      return { result: "win" };
    } else {
      return { result: "correct" };
    }
  };

  const getIncorrectResult = (maxLikeness: number): SubmitResult => {
    setMistakesRemaning(mistakesRemaining - 1);

    if (mistakesRemaining === 1) {
      return { result: "loss" };
    } else if (maxLikeness === 3) {
      return { result: "one-away" };
    } else {
      return { result: "incorrect" };
    }
  };

  const handleLoss = async () => {
    if (!puzzleCategories) return;

    const remainingCategories = puzzleCategories.filter(
      (category) => !clearedCategories.includes(category)
    );

    deselectAllWords();

    for (const category of remainingCategories) {
      await delay(1000);
      setClearedCategories((prev) => [...prev, category]);
      setGameWords((prev) =>
        prev.filter((item) => !category.items.includes(item.word))
      );
    }

    await delay(1000);
    setIsLost(true);
  };

  const handleWin = async () => {
    await delay(1000);
    setIsWon(true);
  };

  return {
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
    handleLoss,
    handleWin,
  };
}
