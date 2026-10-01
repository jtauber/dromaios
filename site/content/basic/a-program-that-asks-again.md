# A program that asks again

Let a program return to its own question. Give someone another try after an
unsuitable answer, calculate several prices in one run, and choose when to
finish.

## Start with the decisions

Load or resume BASIC using the instructions above, and begin at OK. If you
continued directly from [the previous lesson](a-program-that-makes-a-decision.md),
keep its ticket program and skip the setup block below. Each ticket costs
2 pounds; N holds the number of tickets.

If you are starting here or returning from a different lesson, type NEW to
clear the stored program and variables, then enter these lines.

Type one numbered line at a time, pressing Enter and waiting for the complete
echo before sending the next:

```basic-session
> NEW

OK
> 10 PRINT "HOW MANY TICKETS"
> 20 INPUT N
> 22 IF N<0 THEN 80
> 25 IF N=0 THEN 60
> 30 PRINT N*2
> 40 END
> 60 PRINT "NO TICKETS"
> 70 END
> 80 PRINT "PLEASE USE ZERO OR MORE"
> 90 END
```

Every path currently reaches END. After a negative answer, we would rather
explain the problem and ask again, without making someone type RUN.

## Go back to the question

Replace line 90:

```basic-session
> 90 GOTO 10
```

`GOTO 10` means “continue at line 10.” Unlike IF…THEN, GOTO has no condition:
whenever BASIC reaches line 90, it goes to line 10. The 10 is the destination
line number, not a number of repetitions.

This sends execution backward through the stored program. Line 10 prints the
question again, then line 20 receives a new answer. We call a path that returns
to repeat instructions a **loop**.

RUN once. Answer **-1**, then **-2**, then **3**, waiting for each question mark:

```basic-session
> RUN
HOW MANY TICKETS
?
> -1
PLEASE USE ZERO OR MORE
HOW MANY TICKETS
?
> -2
PLEASE USE ZERO OR MORE
HOW MANY TICKETS
?
> 3
 6

OK
```

There is only one RUN in that conversation. Each negative answer takes the
path 22 → 80 → 90 → 10 → 20. Each time we reach INPUT, the new answer replaces
the old value of N. We are continuing the same run, not starting it afresh.

The positive answer still reaches line 30 and prints 6 pounds. Line 40 is
still END, so this path finishes. Only the negative-answer path repeats so far.

[Try the repeated question ↑](#basic-terminal)

## Ask after a price, too

Now let someone calculate several prices without typing RUN between them.
Replace line 40 with another backward GOTO. We will use zero to finish, and
change the printed messages to make that choice clear:

```basic-session
> 10 PRINT "HOW MANY TICKETS (0 TO FINISH)"
> 40 GOTO 10
> 60 PRINT "FINISHED"
```

The zero test on line 25 still goes to line 60. Line 70 is still END, so this
path remains our way out. Zero is an ordinary number; it ends this program
because of the instructions we wrote, not because INPUT treats it specially.

Use LIST to check the complete program before running it:

```basic-session
> LIST

10 PRINT "HOW MANY TICKETS (0 TO FINISH)"
20 INPUT N
22 IF N<0 THEN 80
25 IF N=0 THEN 60
30 PRINT N*2
40 GOTO 10
60 PRINT "FINISHED"
70 END
80 PRINT "PLEASE USE ZERO OR MORE"
90 GOTO 10
OK
```

**Predict the conversation.** If we answer 3, -1, 1, then 0, which answers
produce a price? Which make BASIC ask again?

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
FINISHED

OK
```

The two positive answers produce 6 pounds and 2 pounds. These are separate
prices: nothing in the program adds them to a running total. The negative
answer produces our explanation. All three lead back to the question.
Zero produces FINISHED and returns to OK, with no further question.

[Try one run with several answers ↑](#basic-terminal)

## Follow the three paths

The stored lines remain in number order, but execution does not have to
follow that order all the way to the end:

| Answer | Lines followed after INPUT | What happens next? |
| --- | --- | --- |
| Negative | 22 → 80 → 90 → 10 → 20 | Explain, ask again, and wait for another answer. |
| Positive | 22 → 25 → 30 → 40 → 10 → 20 | Print a price, ask again, and wait for another answer. |
| Zero | 22 → 25 → 60 → 70 | Print FINISHED and end the run. |

Both GOTOs return to line 10 so the question is printed each time. If they
went to line 20 instead, INPUT would still ask for a number with `?`, but the
words HOW MANY TICKETS would not be printed again.

**Does the program have to calculate a price before it can finish?** Try zero
as the very first answer in a new run:

```basic-session
> RUN
HOW MANY TICKETS (0 TO FINISH)
?
> 0
FINISHED

OK
```

The exit can be taken on the first answer or after many trips around the
loop. END finishes that run; it does not erase the program. Another RUN can
use the same stored lines again.

## Waiting is part of the loop

Each trip back reaches INPUT and waits for you. While `?` is showing, give
the program a number, not a BASIC command. To finish normally, answer **0**.
At OK, BASIC is ready for commands such as LIST or RUN again.

Leave the browser's processor RUN control running during this conversation.
That lets BASIC receive your answers, execute the stored program, and wait
for commands afterward. The program's END and the browser's STOP control
work at different levels.

We still expect whole numbers of tickets. Repeating the question has not added
a check for fractions; a positive fraction would still produce a price.

[Experiment with the loop ↑](#basic-terminal)

The original [Altair BASIC manual](https://altairclone.com/downloads/manuals/BASIC%20Manual%2075.pdf){:target="_blank" rel="noopener"}
introduces repetition with GOTO on printed page 8 and describes GOTO and
IF…THEN on printed page 33.
