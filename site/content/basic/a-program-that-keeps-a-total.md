# A program that keeps a total

Keep a running total as a program works through several numbers. Give the
current number and the total separate names, then use the same idea to add
up successive ticket purchases.

## Keep the counter

Load or resume BASIC using the instructions above, and begin at OK. If you
continued directly from [the previous lesson](counting-with-for-and-next.md),
keep its program and skip the setup block below. It should print 1 through 5.

If you are starting here or returning from a different lesson, type NEW and
enter this program. Type one numbered line at a time, pressing Enter and
waiting for its complete echo before the next:

```basic-session
> NEW

OK
> 10 FOR N=1 TO 5
> 20 PRINT N
> 30 NEXT N
> 50 END
```

We already have a way to visit each number. Now we want to add those numbers
together, keeping what we have added so far. We will call that total `T`.

## Add to what we already have

Add line 5, replace line 20, and add line 40:

```basic-session
> 5 LET T=0
> 20 LET T=T+N
> 40 PRINT T
```

Before the loop starts, line 5 sets T to zero: nothing has been added yet.
Each time through the loop, `LET T=T+N` adds the current N to the old T,
then stores the result back in T.

This works like `LET N=N+1` in the counting lesson. We calculate from an
old value and replace it with a new one. Here the amount being added is
the current value of another variable, N.

LIST shows where the new instructions sit:

```basic-session
> LIST

5 LET T=0
10 FOR N=1 TO 5
20 LET T=T+N
30 NEXT N
40 PRINT T
50 END
OK
```

Line 20 is inside the loop, so it adds something on every trip. Line 40 is
after NEXT, so it prints only when the loop has finished.

**Predict the total.** What is 1 + 2 + 3 + 4 + 5?

```basic-session
> RUN
 15

OK
```

[Add the five numbers ↑](#basic-terminal)

## Two variables, two jobs

N selects the number being added. T remembers the sum so far. Follow them
through the five trips to line 20:

| N to add | T before the addition | T after the addition |
| --- | --- | --- |
| 1 | 0 | 1 |
| 2 | 1 | 3 |
| 3 | 3 | 6 |
| 4 | 6 | 10 |
| 5 | 10 | 15 |

When N is 3, for example, T already holds 1 + 2, which is 3. Line 20 adds
the new 3 to that earlier total and stores 6. It does not replace the total
with N alone.

After the last addition, NEXT changes N from 5 to 6 and ends the loop.
There is no trip to line 20 with N equal to 6, so 6 is never added to T.
Check both values at OK:

```basic-session
> PRINT N
 6

OK
> PRINT T
 15

OK
```

Changing N did not change T automatically. T changed only when BASIC
executed an instruction assigning it a value.

## Start each total at zero

**What will another RUN print: 15 or 30?**

```basic-session
> RUN
 15

OK
```

Each run reaches line 5 before the loop, so it starts a new total at zero.
Trips around the loop return to line 20, leaving T available for the next
addition. If we put `LET T=0` inside the loop, it would throw away the
earlier additions on every trip.

Try a shorter count by changing only the limit on line 10:

```basic-session
> 10 FOR N=1 TO 3
> RUN
 6

OK
```

This run adds 1 + 2 + 3. It starts its own total rather than adding to the
15 left by the previous run.

[Try a different limit ↑](#basic-terminal)

## Add up ticket purchases

Return to the idea from [the repeating ticket program](a-program-that-asks-again.md).
Each ticket costs 2 pounds. Someone can enter several purchases, then enter
zero to finish. We will print each purchase's price and keep the total to
show at the end.

Type NEW to clear the counting program, then enter these lines one at a
time. The familiar ticket program now has a starting total on line 5, an
addition on line 35, and a total to print on lines 60 and 65:

```basic-session
> NEW

OK
> 5 LET T=0
> 10 PRINT "HOW MANY TICKETS (0 TO FINISH)"
> 20 INPUT N
> 22 IF N<0 THEN 80
> 25 IF N=0 THEN 60
> 30 PRINT N*2
> 35 LET T=T+N*2
> 40 GOTO 10
> 60 PRINT "TOTAL POUNDS"
> 65 PRINT T
> 70 END
> 80 PRINT "PLEASE USE ZERO OR MORE"
> 90 GOTO 10
```

N now comes from INPUT. It holds the number of tickets in the current
purchase. T holds **pounds**, the combined price of all accepted purchases
in this run.

On line 35, BASIC works out `N*2` first, then adds that price to the old T.
Both GOTOs return to line 10, so they pass over the instruction that clears
T on line 5. The total survives while the program asks its next question.

The negative and zero tests happen before the addition. A negative answer
gets an explanation and another question. Zero goes to the final total.
Neither path adds a price.

**Predict the total for 3, -1, 1, then 0.** Enter each answer only when the
question mark appears:

```basic-session
> RUN
HOW MANY TICKETS (0 TO FINISH)
?
> 3
 6
HOW MANY TICKETS (0 TO FINISH)
?
> -1
PLEASE USE ZERO OR MORE
HOW MANY TICKETS (0 TO FINISH)
?
> 1
 2
HOW MANY TICKETS (0 TO FINISH)
?
> 0
TOTAL POUNDS
 8

OK
```

Three tickets cost 6 pounds, and one more costs 2 pounds. The rejected
negative answer left the total unchanged. Together the accepted purchases
cost 8 pounds; the separate prices printed along the way were 6 and 2.

[Try several purchases ↑](#basic-terminal)

## Check a new run and an empty one

Start another run, buy two tickets, and finish:

```basic-session
> RUN
HOW MANY TICKETS (0 TO FINISH)
?
> 2
 4
HOW MANY TICKETS (0 TO FINISH)
?
> 0
TOTAL POUNDS
 4

OK
```

The total is 4, not 12. Line 5 started it at zero, so the 8 pounds from the
earlier run did not carry over.

**What if we finish before buying anything?**

```basic-session
> RUN
HOW MANY TICKETS (0 TO FINISH)
?
> 0
TOTAL POUNDS
 0

OK
```

No purchase reached line 35. The total is still the zero we started with.
While a question mark is showing, answer with a number; at OK, BASIC is
ready for another command. Leave the browser's processor RUN control running
during these conversations.

As before, this program expects whole numbers of tickets. It rejects
negative answers but still has no check for positive fractions.

The FOR loop supplied a fixed sequence of numbers. The ticket program
receives an open-ended sequence of purchases. In both, a separate variable
keeps the result of earlier additions available for the next one.
