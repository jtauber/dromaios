# Finding and fixing a mistake

A program can run without an error message and still give the wrong answer.
Use temporary PRINT instructions to see what happens inside a loop, find
one misplaced line, and check the repair.

## An answer we can check

Load or resume BASIC using the instructions above, and begin at OK. Even if
you continued from [the previous lesson](a-program-that-keeps-a-total.md),
start a new program here. NEW removes the program currently in memory.

This version of the running-total program has a mistake. Enter it exactly
as shown so that we can investigate together. Type one numbered line at a
time, pressing Enter and waiting for its complete echo before the next:

```basic-session
> NEW

OK
> 10 FOR N=1 TO 5
> 15 LET T=0
> 20 LET T=T+N
> 30 NEXT N
> 40 PRINT T
> 50 END
```

We want the program to add 1 + 2 + 3 + 4 + 5. Before running it, work out
that sum: the answer should be 15.

```basic-session
> RUN
 5

OK
```

BASIC accepts every instruction and finishes normally, but the result is
wrong. Finding and fixing a mistake like this is called **debugging**.
We need to compare what the program actually does with what we intended.

[Try the program ↑](#basic-terminal)

## Look inside the loop

At the moment, we see T only after the loop has finished. We can also
print it just after each addition.

For a shorter investigation, change the limit to 3. The intended answer
is now 1 + 2 + 3, which is 6. Add two temporary PRINT instructions:

```basic-session
> 10 FOR N=1 TO 3
> 22 PRINT "SO FAR"
> 24 PRINT T
```

Lines 22 and 24 sit between the addition on line 20 and NEXT on line 30.
Each trip through the loop will print SO FAR followed by the value just
stored in T. They let us watch the calculation without changing it.

**Predict the three running totals.** If the program worked, they would
be 1, then 3, then 6. Now look at what it actually prints:

```basic-session
> RUN
SO FAR
 1
SO FAR
 2
SO FAR
 3
 3

OK
```

The last number is the final result from line 40. The earlier numbers,
each following SO FAR, show how we reached it.

| N being added | Intended T after the addition | Actual T after the addition |
| --- | --- | --- |
| 1 | 1 | 1 |
| 2 | 3 | 2 |
| 3 | 6 | 3 |

The first addition is right. The second is the first place where the
values differ: we wanted the old total of 1 plus the new N of 2, but we
got only 2. The earlier total seems to have been lost.

[Watch the intermediate values ↑](#basic-terminal)

## Find the instruction responsible

Use LIST to inspect the instructions in the order BASIC stores them:

```basic-session
> LIST

10 FOR N=1 TO 3
15 LET T=0
20 LET T=T+N
22 PRINT "SO FAR"
24 PRINT T
30 NEXT N
40 PRINT T
50 END
OK
```

On the first trip, line 15 sets T to zero and line 20 adds 1. So far,
that is what we want.

When NEXT starts another trip, execution returns to the instruction after
FOR: line 15. That sets T to zero again, throwing away the 1 we just added.
Line 20 then adds 2 to zero, giving 2. The same thing happens with 3.

The addition itself is right. The instruction that starts a new total is
in the wrong place: it runs on every trip instead of once before the loop.

## Move the line and watch again

Put `LET T=0` before FOR by entering it as line 5. Then delete line 15 by
typing its number alone. Adding line 5 does not remove line 15 for us;
we need both edits:

```basic-session
> 5 LET T=0
> 15
```

Keep the temporary PRINT lines for now. They can show whether our change
had the effect we expected:

```basic-session
> RUN
SO FAR
 1
SO FAR
 3
SO FAR
 6
 6

OK
```

The running totals now match our prediction, and the final answer is 6.
Line 5 starts T at zero before the loop. Each later trip keeps the previous
total and adds the next N.

[Repair the program ↑](#basic-terminal)

## Remove the temporary output

We added lines 22 and 24 to investigate the mistake. Delete them now that
they have done their job, then list the finished program:

```basic-session
> 22
> 24
> LIST

5 LET T=0
10 FOR N=1 TO 3
20 LET T=T+N
30 NEXT N
40 PRINT T
50 END
OK
> RUN
 6

OK
```

Removing those PRINT instructions changes what we see, but does not
change the calculation. We still get the sum of 1 + 2 + 3.

## Check more than one case

A correct answer for one limit is a useful check. Try a loop with just
one trip as well. It should add only 1:

```basic-session
> 10 FOR N=1 TO 1
> RUN
 1

OK
```

Finally, return to the original limit of 5 and check the answer that first
revealed the mistake:

```basic-session
> 10 FOR N=1 TO 5
> RUN
 15

OK
> RUN
 15

OK
```

Both runs start a fresh total at line 5 and produce 15. We have checked
one trip, several trips, and a repeated run. Those checks support the
repair, and following the instructions explains why it works.

[Check the repaired program ↑](#basic-terminal)

## A method to keep

When a program gives a surprising result:

1. Choose a small example whose answer you can work out yourself.
2. Print intermediate values and find the first point where they differ
   from your prediction.
3. Use LIST to follow the instructions that produced those values.
4. Make a change you can explain, then run the same example again.
5. Remove temporary output and check a few other cases.

We did not need a new BASIC command to do this. PRINT and LIST gave us
enough information to connect a wrong answer to the instruction that
caused it.
